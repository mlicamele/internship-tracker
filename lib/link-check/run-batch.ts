// Shared batch runner for the link validator. Called by both
// scripts/validate-links.ts (CLI) and /api/cron/validate-links
// (nightly). Keeps the query + probe loop + summary shape in one
// place so the two entry points stay in lockstep.

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkLink } from "./check-link";
import type { LinkStatus } from "@/lib/db/types";

export interface LinkValidationRoleTransition {
  role_id: string;
  label: string;
  from: LinkStatus;
  to: LinkStatus;
  reason: string;
  jd_url: string;
}

export interface LinkValidationSummary {
  total_triage_roles: number;
  checked: number;
  live: number;
  dead: number;
  suspect: number;
  unknown: number;
  transitions: LinkValidationRoleTransition[];
  wrote_updates: boolean;
  wall_clock_ms: number;
}

export interface LinkValidationOptions {
  /** True → persist link_status + link_checked_at. False → dry-run. */
  apply: boolean;
  /**
   * Roles whose last check is older than this are re-probed. Roles never
   * checked (`link_checked_at IS NULL`) are always probed regardless.
   */
  staleDays: number;
  /** True → probe every role in triage, ignoring `link_checked_at`. */
  recheckAll?: boolean;
  /** Cap the number of probes per run. Cron uses this to stay under 60 s. */
  maxProbes?: number;
  /** Wall-clock cap per run (ms). Loop breaks if the budget's exhausted. */
  wallClockBudgetMs?: number;
  /** Delay between probes (ms). Rate-limit courtesy on shared upstream hosts. */
  delayBetweenProbesMs?: number;
  /** Optional progress hook — receives (index, total, label, result). */
  onProgress?: (
    index: number,
    total: number,
    label: string,
    status: LinkStatus,
    reason: string
  ) => void;
}

interface RoleRow {
  id: string;
  title: string | null;
  jd_url: string | null;
  link_status: LinkStatus;
  link_checked_at: string | null;
  company: { name: string } | null;
}

interface ApplicationRow {
  triage_state: string;
  role: RoleRow | null;
}

export async function runLinkValidation(
  supabase: SupabaseClient,
  opts: LinkValidationOptions
): Promise<LinkValidationSummary> {
  const started = Date.now();
  const {
    apply,
    staleDays,
    recheckAll = false,
    maxProbes = Infinity,
    wallClockBudgetMs = Infinity,
    delayBetweenProbesMs = 400,
    onProgress,
  } = opts;

  const { data, error } = await supabase
    .from("applications")
    .select(
      "triage_state, role:roles!inner(id, title, jd_url, link_status, link_checked_at, company:companies(name))"
    )
    .in("triage_state", ["inbox", "active", "snoozed"]);

  if (error) throw error;
  const rows = (data ?? []) as unknown as ApplicationRow[];

  // Dedupe on role.id.
  const uniqueRoles = new Map<string, RoleRow>();
  for (const row of rows) {
    if (!row.role || !row.role.jd_url) continue;
    if (!uniqueRoles.has(row.role.id)) uniqueRoles.set(row.role.id, row.role);
  }

  const cutoffMs = staleDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const eligible = [...uniqueRoles.values()].filter((r) => {
    if (recheckAll) return true;
    if (!r.link_checked_at) return true;
    return now - new Date(r.link_checked_at).getTime() >= cutoffMs;
  });

  const summary: LinkValidationSummary = {
    total_triage_roles: uniqueRoles.size,
    checked: 0,
    live: 0,
    dead: 0,
    suspect: 0,
    unknown: 0,
    transitions: [],
    wrote_updates: apply,
    wall_clock_ms: 0,
  };

  const nowIso = new Date().toISOString();
  for (let i = 0; i < eligible.length; i++) {
    if (summary.checked >= maxProbes) break;
    if (Date.now() - started >= wallClockBudgetMs) break;

    const role = eligible[i];
    const label = `${role.company?.name ?? "?"} — ${role.title ?? "?"}`;

    const [result] = await Promise.all([
      checkLink(role.jd_url),
      new Promise((r) => setTimeout(r, delayBetweenProbesMs)),
    ]);
    summary.checked++;
    summary[result.status]++;
    onProgress?.(i, eligible.length, label, result.status, result.reason);

    if (
      role.link_status !== result.status &&
      (result.status === "dead" || result.status === "suspect")
    ) {
      summary.transitions.push({
        role_id: role.id,
        label,
        from: role.link_status,
        to: result.status,
        reason: result.reason,
        jd_url: role.jd_url!,
      });
    }

    if (apply) {
      const { error: upErr } = await supabase
        .from("roles")
        .update({
          link_status: result.status,
          link_checked_at: nowIso,
        })
        .eq("id", role.id);
      if (upErr) {
        console.error(`link-check update failed for ${role.id}: ${upErr.message}`);
      }
    }
  }

  summary.wall_clock_ms = Date.now() - started;
  return summary;
}
