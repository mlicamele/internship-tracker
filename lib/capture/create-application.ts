// Shared "given a URL + optional text, create a role + application" flow.
// Consumed by:
//   - the manual /applications/new form action (source: "manual", triage: "draft")
//   - the /api/capture endpoint (source: "capture", triage: "inbox")

import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreate as findOrCreateCompany } from "@/lib/db/companies";
import { create as createRole } from "@/lib/db/roles";
import { createApplication } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { scrapeUrl, type ScrapeResult } from "@/lib/scrape/url";
import { extractJobFromEvidence } from "@/lib/llm/extract-job";
import { geocode } from "@/lib/geocode";
import { computeFitScore } from "@/lib/scoring/fit";
import type {
  RoleLocation,
  RoleSource,
  TriageState,
} from "@/lib/db/types";

export interface CreateFromUrlInput {
  url: string | null;
  pastedJd: string | null;
  notes?: string;
  triageState: TriageState;
  source: RoleSource;
}

export interface CreateFromUrlResult {
  applicationId: string;
  roleId: string;
  company: string;
  title: string;
  thin: boolean;
  overallConfidence: number;
}

/** Summer if before Sept, else next summer. */
function defaultTargetYear(): number {
  const now = new Date();
  return now.getMonth() < 8 ? now.getFullYear() + 1 : now.getFullYear() + 2;
}

/** Last-resort company fallback from URL host / board slug. */
function companyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (
      host.endsWith("greenhouse.io") ||
      host.endsWith("lever.co") ||
      host.endsWith("ashbyhq.com")
    ) {
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        return segments[0]
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    const label = host.split(".")[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "Unknown company";
  }
}

export async function createApplicationFromUrl(
  supabase: SupabaseClient,
  userId: string,
  input: CreateFromUrlInput
): Promise<CreateFromUrlResult> {
  if (!input.url && !input.pastedJd) {
    throw new Error("createApplicationFromUrl requires a url or pastedJd");
  }

  let extracted: ScrapeResult | null = null;
  if (input.url) {
    extracted = await scrapeUrl(input.url, input.pastedJd ?? undefined);
  } else if (input.pastedJd) {
    // Text-only capture (e.g. Shortcut forwarded a TikTok/IG caption with no
    // direct job URL). Skip the scraper's URL pipeline and hand the raw text
    // straight to the LLM.
    const llmOnly = await extractJobFromEvidence({
      url: "",
      userPastedJdBody: input.pastedJd,
    });
    extracted = { ...llmOnly, thin: false, evidence_sources: [] };
  }

  const companyName =
    extracted?.company?.trim() ||
    (input.url ? companyFromUrl(input.url) : "Unknown company");
  const roleTitle = extracted?.title?.trim() || "Untitled role";
  const jdBodyText = extracted?.jd_body || input.pastedJd || null;
  const jdUrl = input.url ?? null;
  const targetYear = extracted?.target_year ?? defaultTargetYear();

  const locations: RoleLocation[] = [];
  for (const loc of extracted?.locations ?? []) {
    const text = loc.text.trim();
    if (!text) continue;
    let lat: number | null = loc.lat ?? null;
    let lng: number | null = loc.lng ?? null;
    if (lat == null || lng == null) {
      try {
        const coords = await geocode(text);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      } catch {
        // best-effort — null coords are OK
      }
    }
    locations.push({ text, lat, lng });
  }

  const company = await findOrCreateCompany(supabase, companyName);

  const extractionSnapshot = extracted
    ? {
        values: {
          company: extracted.company,
          title: extracted.title,
          locations: extracted.locations.map((l) => l.text),
          deadline_at: extracted.deadline_at,
          posted_at: extracted.posted_at,
          work_model: extracted.work_model,
          target_year: extracted.target_year,
          target_season: extracted.target_season,
          min_grad_year: extracted.min_grad_year,
          max_grad_year: extracted.max_grad_year,
          relocation_assistance: extracted.relocation_assistance,
          compensation_hourly_dollars: extracted.compensation_hourly_dollars,
          tags: extracted.tags,
        },
        confidences: extracted.confidences,
      }
    : { values: {}, confidences: {} };

  const role = await createRole(supabase, {
    companyId: company.id,
    title: roleTitle,
    locations,
    jdUrl,
    jdBodyText,
    deadlineAt: extracted?.deadline_at ?? null,
    postedAt: extracted?.posted_at ?? null,
    workModel: extracted?.work_model ?? null,
    targetYear,
    targetSeason: extracted?.target_season ?? "summer",
    compensationHourlyDollars: extracted?.compensation_hourly_dollars ?? null,
    minGradYear: extracted?.min_grad_year ?? null,
    maxGradYear: extracted?.max_grad_year ?? null,
    relocationAssistance: extracted?.relocation_assistance ?? null,
    tags: extracted?.tags ?? [],
    extractionConfidences: extracted?.confidences ?? {},
    extractionSnapshot,
    source: input.source,
  });

  const profile = await getProfile(supabase, userId);
  const fitScore = profile ? computeFitScore(role, profile).total : undefined;

  const application = await createApplication(supabase, {
    userId,
    roleId: role.id,
    notes: input.notes ?? "",
    triageState: input.triageState,
    fitScore,
  });

  return {
    applicationId: application.id,
    roleId: role.id,
    company: companyName,
    title: roleTitle,
    thin: extracted?.thin ?? true,
    overallConfidence: extracted?.overall_confidence ?? 0,
  };
}
