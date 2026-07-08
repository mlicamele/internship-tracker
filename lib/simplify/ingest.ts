// Core Phase 5 ingest: take the filtered upstream list and reconcile it
// against our roles/applications catalog.
//
// Design:
//   - Dedup key is (source='scrape_simplify', source_external_id=upstream.id),
//     backed by a UNIQUE partial index (migration 0012).
//   - EXISTING roles get a lightweight refresh: title + locations only. All
//     LLM-derived fields (jd_body_text, extraction_snapshot, min/max_grad_year,
//     work_model, compensation, deadline_at, posted_at) stay untouched so
//     manual edits + prior extraction never get clobbered.
//   - NEW roles run the full scrapeUrl pipeline so they inherit the same
//     min/max_grad_year, comp, snapshot, and revert-button data as
//     paste_url / capture roles.
//   - Per-user application row is created in triage_state='inbox' only if
//     one doesn't already exist for (userId, roleId) — reappearing roles
//     don't resurrect a triaged row (skipped / snoozed / active).
//   - Timeout budget: caller passes `maxNewExtractions` (route handler caps
//     at 15 for Vercel free-tier; seed script leaves it uncapped).
//
// Never throws top-level — per-row extraction failures are captured in
// `extraction_errors` and the loop continues.

import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreate as findOrCreateCompany } from "@/lib/db/companies";
import { create as createRole, updateRole, getById as getRoleById } from "@/lib/db/roles";
import { createApplication } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { scrapeUrl } from "@/lib/scrape/url";
import { geocode } from "@/lib/geocode";
import { computeFitScore } from "@/lib/scoring/fit";
import type { RoleLocation } from "@/lib/db/types";
import { fetchSimplifySummerListings, type SimplifyRow } from "./fetch";

export interface IngestOptions {
  /** Max new-role extractions per invocation. Undefined = uncapped (seed harness). */
  maxNewExtractions?: number;
  /** How many scrapeUrl calls to run in parallel. Default 3 (Groq TPM budget). */
  concurrency?: number;
  /**
   * Wall-clock deadline in ms since start. If exceeded, no NEW batches start
   * (in-flight ones finish). Undefined = no deadline (seed harness).
   * Cron sets this ~45s to leave headroom under Vercel's 60s free-tier cap.
   */
  wallClockBudgetMs?: number;
  /** Log what would change, skip DB writes. */
  dryRun?: boolean;
  /** For local test — swap the upstream URL. */
  overrideUrl?: string;
  /** Per-row progress callback (id + status message). */
  onProgress?: (msg: string) => void;
}

export interface IngestSummary {
  fetched: number;
  filtered_out: number;
  skipped_malformed: number;
  matched_existing: number;
  new_candidates: number;
  extracted_now: number;
  new_roles: number;
  updated_roles: number;
  new_applications: number;
  existing_applications: number;
  deferred: number;
  extraction_errors: { id: string; url: string; message: string }[];
  duration_ms: number;
  fetch_warnings: string[];
}

const DEFAULT_CONCURRENCY = 3;

/** Summer of `year Y`: use extracted target_year, else fall back to current-cycle default. */
function defaultTargetYear(): number {
  const now = new Date();
  return now.getMonth() < 8 ? now.getFullYear() + 1 : now.getFullYear() + 2;
}

function toIso(unixSeconds: number | null): string | null {
  if (unixSeconds === null) return null;
  const d = new Date(unixSeconds * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Fetch existing scrape_simplify roles that match these upstream ids in ONE query. */
async function loadExistingRoles(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, { id: string; title: string; locations: RoleLocation[] }>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("roles")
    .select("id, title, locations, source_external_id")
    .eq("source", "scrape_simplify")
    .in("source_external_id", ids);
  if (error) throw error;
  const out = new Map<string, { id: string; title: string; locations: RoleLocation[] }>();
  for (const r of data ?? []) {
    if (r.source_external_id) {
      out.set(r.source_external_id as string, {
        id: r.id as string,
        title: r.title as string,
        locations: (r.locations as RoleLocation[]) ?? [],
      });
    }
  }
  return out;
}

/** Fetch existing application role_ids for this user in one query. */
async function loadExistingApplicationRoleIds(
  supabase: SupabaseClient,
  userId: string,
  roleIds: string[]
): Promise<Set<string>> {
  if (roleIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("applications")
    .select("role_id")
    .eq("user_id", userId)
    .in("role_id", roleIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.role_id as string));
}

/** Locations from upstream strings → geocoded RoleLocation[]. Best-effort. */
async function geocodeLocations(
  texts: string[]
): Promise<RoleLocation[]> {
  const out: RoleLocation[] = [];
  for (const rawText of texts) {
    const text = rawText.trim();
    if (!text) continue;
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const c = await geocode(text);
      if (c) {
        lat = c.lat;
        lng = c.lng;
      }
    } catch {
      // best-effort
    }
    out.push({ text, lat, lng });
  }
  return out;
}

/**
 * Have the visible fields drifted enough to bother writing?
 *
 * Only compares title. Locations are intentionally excluded because
 * upstream texts (e.g. "San Francisco, CA") often differ from what the
 * scrape/LLM extracted at role-creation time (e.g. "San Francisco,
 * California, United States") *even though they refer to the same place*.
 * Blindly overwriting on refresh would wipe the geocoded lat/lng that
 * powers distance sort, since a text-mismatch means we can't map old
 * coords to new text. So we leave locations alone and trust the initial
 * extraction; user can edit manually if a role's location genuinely
 * changes.
 */
function shouldRefresh(
  existing: { title: string; locations: RoleLocation[] },
  row: SimplifyRow
): boolean {
  return existing.title !== row.title;
}

/** Chunk an array into groups of `n`. */
function chunk<T>(arr: T[], n: number): T[][] {
  if (n <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function ingestSimplifyListings(
  supabase: SupabaseClient,
  userId: string,
  opts: IngestOptions = {}
): Promise<IngestSummary> {
  const t0 = Date.now();
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const progress = opts.onProgress ?? (() => {});

  const summary: IngestSummary = {
    fetched: 0,
    filtered_out: 0,
    skipped_malformed: 0,
    matched_existing: 0,
    new_candidates: 0,
    extracted_now: 0,
    new_roles: 0,
    updated_roles: 0,
    new_applications: 0,
    existing_applications: 0,
    deferred: 0,
    extraction_errors: [],
    duration_ms: 0,
    fetch_warnings: [],
  };

  // Fetch profile once for fit-score computation across all app-creates this
  // run. Null profile → we skip fit-score persistence and rows land with
  // fit_score=null; the next profile-save action recomputes them.
  const scoringProfile = await getProfile(supabase, userId);

  const fetchResult = await fetchSimplifySummerListings(opts.overrideUrl);
  summary.fetched = fetchResult.fetched;
  summary.filtered_out = fetchResult.filtered_out;
  summary.skipped_malformed = fetchResult.skipped_malformed;
  summary.fetch_warnings = fetchResult.warnings;

  const rows = fetchResult.rows;
  progress(
    `fetched=${summary.fetched} matched_filter=${rows.length} filtered_out=${summary.filtered_out} malformed=${summary.skipped_malformed}`
  );

  const existingRoleMap = await loadExistingRoles(
    supabase,
    rows.map((r) => r.id)
  );
  summary.matched_existing = existingRoleMap.size;

  const newRows: SimplifyRow[] = [];
  const existingRows: { row: SimplifyRow; existing: { id: string; title: string; locations: RoleLocation[] } }[] = [];
  for (const row of rows) {
    const hit = existingRoleMap.get(row.id);
    if (hit) existingRows.push({ row, existing: hit });
    else newRows.push(row);
  }
  summary.new_candidates = newRows.length;

  // ---------- 1. Refresh existing roles (cheap, no LLM) ----------
  for (const { row, existing } of existingRows) {
    if (!shouldRefresh(existing, row)) continue;
    if (opts.dryRun) {
      summary.updated_roles++;
      progress(`[dry] refresh role ${existing.id} (${row.company_name}: ${row.title})`);
      continue;
    }
    try {
      // Refresh title only — never locations (see shouldRefresh comment).
      await updateRole(supabase, existing.id, {
        title: row.title,
      });
      summary.updated_roles++;
    } catch (err) {
      summary.extraction_errors.push({
        id: row.id,
        url: row.url,
        message: err instanceof Error ? err.message : "refresh failed",
      });
    }
  }

  // ---------- 2. Cap new-role extractions ----------
  const cap = opts.maxNewExtractions;
  const toExtract = cap !== undefined ? newRows.slice(0, cap) : newRows;
  summary.deferred = newRows.length - toExtract.length;
  summary.extracted_now = toExtract.length;

  // Load existing applications for the ROLES we already know about, so
  // reappearing catalog rows don't dupe an application. New-role rows can't
  // have applications yet by definition.
  const existingApplicationRoleIds = await loadExistingApplicationRoleIds(
    supabase,
    userId,
    Array.from(existingRoleMap.values()).map((r) => r.id)
  );
  // For each already-existing role in this fetch, ensure an application row
  // exists (only creates one if user has never seen this role).
  for (const { existing } of existingRows) {
    if (existingApplicationRoleIds.has(existing.id)) {
      summary.existing_applications++;
      continue;
    }
    if (opts.dryRun) {
      summary.new_applications++;
      progress(`[dry] new application for existing role ${existing.id}`);
      continue;
    }
    try {
      // Fetch full role for fit-score compute — the `existing` shape only
      // carries id/title/locations. Rare path (reappearing catalog row for a
      // user without an application to it yet).
      let fitScore: number | undefined;
      if (scoringProfile) {
        const fullRole = await getRoleById(supabase, existing.id);
        if (fullRole) {
          fitScore = computeFitScore(fullRole, scoringProfile).total;
        }
      }
      await createApplication(supabase, {
        userId,
        roleId: existing.id,
        triageState: "inbox",
        fitScore,
      });
      summary.new_applications++;
    } catch (err) {
      summary.extraction_errors.push({
        id: existing.id,
        url: "(existing role)",
        message: err instanceof Error ? err.message : "app create failed",
      });
    }
  }

  // ---------- 3. Extract + create new roles (concurrency-limited) ----------
  const batches = chunk(toExtract, concurrency);
  let batchesRun = 0;
  for (const batch of batches) {
    // Wall-clock budget: if we're over the deadline, roll the remaining
    // batches into `deferred`. In-flight geocoding is throttled 1.5s per
    // call and can push a batch to ~15s wall-clock, so we bail EARLY.
    if (
      opts.wallClockBudgetMs !== undefined &&
      Date.now() - t0 > opts.wallClockBudgetMs
    ) {
      const remaining = batches.slice(batchesRun).reduce((n, b) => n + b.length, 0);
      summary.extracted_now -= remaining;
      summary.deferred += remaining;
      progress(
        `wall-clock budget exceeded, deferring ${remaining} unstarted extractions`
      );
      break;
    }
    batchesRun++;
    await Promise.all(
      batch.map(async (row) => {
        try {
          progress(`extract ${row.company_name}: ${row.title}`);
          const extracted = await scrapeUrl(row.url);

          // Trust the upstream (human-curated by Simplify maintainers) for
          // company + title. LLM extraction against a dead URL or bot wall
          // returns garbage like "Page not found - Point72" that we'd rather
          // not persist.
          const companyName = row.company_name;
          const roleTitle = row.title;

          // Prefer scrape locations (fuller signal from board API / JSON-LD),
          // fall back to upstream texts.
          const locTexts =
            extracted.locations.length > 0
              ? extracted.locations.map((l) => l.text)
              : row.locations;
          const locations = await geocodeLocations(locTexts);

          const postedAt =
            extracted.posted_at ?? toIso(row.date_posted);

          // Snapshot MUST reflect what we actually persist — otherwise the
          // per-field revert button restores the LLM's (potentially garbage)
          // extraction. Since we override company/title with the upstream
          // human-curated values, mirror those into the snapshot and mark
          // them "high" confidence.
          const snapshotConfidences = { ...extracted.confidences };
          snapshotConfidences.company = "high";
          snapshotConfidences.title = "high";
          const extractionSnapshot = {
            values: {
              company: companyName,
              title: roleTitle,
              locations: extracted.locations.map((l) => l.text),
              deadline_at: extracted.deadline_at,
              posted_at: extracted.posted_at,
              work_model: extracted.work_model,
              target_year: extracted.target_year,
              target_season: extracted.target_season,
              min_grad_year: extracted.min_grad_year,
              max_grad_year: extracted.max_grad_year,
              relocation_assistance: extracted.relocation_assistance,
              compensation_hourly_dollars:
                extracted.compensation_hourly_dollars,
              tags: extracted.tags,
            },
            confidences: snapshotConfidences,
          };

          if (opts.dryRun) {
            summary.new_roles++;
            summary.new_applications++;
            progress(
              `[dry] new role ${row.id}: ${companyName} / ${roleTitle} (thin=${extracted.thin})`
            );
            return;
          }

          const company = await findOrCreateCompany(supabase, companyName);

          const role = await createRole(supabase, {
            companyId: company.id,
            title: roleTitle,
            locations,
            jdUrl: row.url,
            jdBodyText: extracted.jd_body || null,
            deadlineAt: extracted.deadline_at,
            postedAt,
            workModel: extracted.work_model,
            targetYear: extracted.target_year ?? defaultTargetYear(),
            targetSeason: extracted.target_season,
            compensationHourlyDollars: extracted.compensation_hourly_dollars,
            minGradYear: extracted.min_grad_year,
            maxGradYear: extracted.max_grad_year,
            relocationAssistance: extracted.relocation_assistance,
            tags: extracted.tags,
            extractionConfidences: snapshotConfidences,
            extractionSnapshot,
            source: "scrape_simplify",
            sourceExternalId: row.id,
          });

          summary.new_roles++;

          try {
            const fitScore = scoringProfile
              ? computeFitScore(role, scoringProfile).total
              : undefined;
            await createApplication(supabase, {
              userId,
              roleId: role.id,
              triageState: "inbox",
              fitScore,
            });
            summary.new_applications++;
          } catch (appErr) {
            // Applications UNIQUE (user_id, role_id) — race with a manual
            // add of the same role from paste_url is possible but unlikely.
            summary.extraction_errors.push({
              id: row.id,
              url: row.url,
              message:
                appErr instanceof Error
                  ? `app: ${appErr.message}`
                  : "app create failed",
            });
          }
        } catch (err) {
          summary.extraction_errors.push({
            id: row.id,
            url: row.url,
            message: err instanceof Error ? err.message : "extract failed",
          });
        }
      })
    );
  }

  summary.duration_ms = Date.now() - t0;
  return summary;
}
