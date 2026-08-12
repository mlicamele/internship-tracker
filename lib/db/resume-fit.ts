// DAL for the resume-fit metric. Wraps lib/scoring/resume-fit.ts with
// input resolution (effective resume = attached ?? master), a cache-hash
// check to skip re-scoring unchanged pairs, and persistence to the
// applications.resume_fit_* columns from migration 0016.
//
// Never throws — errors are logged and the row is left untouched so the
// next attempt can retry. Callers that need "did this actually score"
// can inspect the returned `outcome`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Application,
  Company,
  ResumeVersion,
  Role,
  TriageState,
} from "./types";
import {
  computeInputHash,
  scoreResumeFit,
  type ResumeFitResult,
} from "@/lib/scoring/resume-fit";

/**
 * Triage states that ignore any per-app resume attachment and score
 * against the user's master resume. Rationale: during triage the user
 * hasn't committed to a resume yet — the score should reflect what
 * their MAIN resume can land, not stale per-app choices. Once the app
 * moves out of inbox (into active / snoozed), attached ?? master applies.
 */
const MASTER_ONLY_TRIAGE_STATES: ReadonlySet<TriageState> = new Set(["inbox"]);

/** Reason a call didn't produce a fresh score. Distinct from LLM `skippedReason`. */
export type ScoreOutcome =
  | "scored"
  | "cache_hit"
  | "insufficient_text"
  | "no_resume"
  | "llm_error"
  | "not_found";

export interface ScoreResult {
  applicationId: string;
  outcome: ScoreOutcome;
  /** New score persisted (or existing, on cache hit). Null when no resume / insufficient. */
  score: number | null;
}

/** Application-shaped row we need to score. Not a full ApplicationRow to keep queries lean. */
type ScoreInputRow = Pick<
  Application,
  | "id"
  | "user_id"
  | "resume_version_id"
  | "resume_fit_input_hash"
  | "triage_state"
> & {
  role: Pick<Role, "id" | "title" | "tags" | "jd_body_text"> & {
    company: Pick<Company, "name"> | null;
  };
};

/**
 * Score one application. Resolves effective resume (per triage rules or
 * an explicit override), checks the cache hash, calls the LLM only on
 * miss, and persists.
 *
 * @param force                      Skip cache check and always call the LLM.
 * @param resumeVersionIdOverride    Force a specific resume, bypassing the
 *                                   default triage/master resolution.
 *                                   Used by the /inbox triage picker.
 */
export async function scoreAndPersistResumeFit(
  supabase: SupabaseClient,
  applicationId: string,
  options: { force?: boolean; resumeVersionIdOverride?: string | null } = {}
): Promise<ScoreResult> {
  const app = await loadScoreInputRow(supabase, applicationId);
  if (!app) {
    return { applicationId, outcome: "not_found", score: null };
  }

  const resume = await resolveEffectiveResume(
    supabase,
    app.user_id,
    app.resume_version_id,
    app.triage_state,
    options.resumeVersionIdOverride ?? null
  );

  return runScoreAndPersist(supabase, app, resume, options.force ?? false);
}

/**
 * Batch variant. Loads master resume once, then iterates. The Groq
 * rate-limiter serializes calls process-wide, so a Promise.all here just
 * queues; kept sequential to preserve log ordering. Returns per-app
 * outcomes for the caller to summarize.
 */
export async function rescoreResumeFitBatch(
  supabase: SupabaseClient,
  applicationIds: string[],
  options: { force?: boolean; resumeVersionIdOverride?: string | null } = {}
): Promise<ScoreResult[]> {
  const results: ScoreResult[] = [];
  for (const id of applicationIds) {
    results.push(await scoreAndPersistResumeFit(supabase, id, options));
  }
  return results;
}

/**
 * Rescore every inbox app for the user against a specific resume version.
 * Used by the /inbox triage picker: user chooses "score against Resume v2"
 * and this batch overwrites resume_fit_score across their inbox.
 */
export async function rescoreInboxAgainstResume(
  supabase: SupabaseClient,
  userId: string,
  resumeVersionId: string
): Promise<ScoreResult[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .eq("triage_state", "inbox");
  if (error) throw error;
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  return rescoreResumeFitBatch(supabase, ids, {
    resumeVersionIdOverride: resumeVersionId,
  });
}

/**
 * Rescore every application currently attached to the given role.
 * Called from role-edit paths that touch tags or jd_body_text.
 */
export async function rescoreResumeFitForRole(
  supabase: SupabaseClient,
  roleId: string
): Promise<ScoreResult[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("role_id", roleId)
    .in("triage_state", ["inbox", "active", "snoozed"]);
  if (error) throw error;
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  return rescoreResumeFitBatch(supabase, ids);
}

/**
 * Rescore every application for the user that resolves to the master resume
 * (i.e. has no explicit resume_version_id). Called on upload-of-first / master-swap.
 */
export async function rescoreResumeFitForUserMaster(
  supabase: SupabaseClient,
  userId: string
): Promise<ScoreResult[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .is("resume_version_id", null)
    .in("triage_state", ["inbox", "active", "snoozed"]);
  if (error) throw error;
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  return rescoreResumeFitBatch(supabase, ids, { force: true });
}

/**
 * Rescore every scored-triage-state application for the user, respecting
 * cache hashes. Used by the manual backfill script.
 */
export async function rescoreAllResumeFitForUser(
  supabase: SupabaseClient,
  userId: string,
  options: { force?: boolean } = {}
): Promise<ScoreResult[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .in("triage_state", ["inbox", "active", "snoozed"]);
  if (error) throw error;
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  return rescoreResumeFitBatch(supabase, ids, options);
}

// ------------------------------------------------------------
// Internals
// ------------------------------------------------------------

const SCORE_INPUT_SELECT = `
  id,
  user_id,
  resume_version_id,
  resume_fit_input_hash,
  triage_state,
  role:roles(
    id,
    title,
    tags,
    jd_body_text,
    company:companies(name)
  )
`;

async function loadScoreInputRow(
  supabase: SupabaseClient,
  applicationId: string
): Promise<ScoreInputRow | null> {
  const { data, error } = await supabase
    .from("applications")
    .select(SCORE_INPUT_SELECT)
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as unknown as ScoreInputRow;
}

async function resolveEffectiveResume(
  supabase: SupabaseClient,
  userId: string,
  explicitId: string | null,
  triageState: TriageState,
  overrideId: string | null
): Promise<ResumeVersion | null> {
  // Explicit override wins (triage picker forcing "score against Resume v2").
  if (overrideId) {
    const { data, error } = await supabase
      .from("resume_versions")
      .select("*")
      .eq("id", overrideId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as ResumeVersion;
    // Override id doesn't belong to this user (or was deleted) — fall through.
  }

  // During inbox triage, default to master. This matches the UX rule the
  // user set: the triage number tells you "would my MAIN resume land this?"
  // regardless of any stale per-app attachments left over from earlier
  // sessions. Once the app moves to active, per-app attach wins.
  const useMasterOnly = MASTER_ONLY_TRIAGE_STATES.has(triageState);

  if (!useMasterOnly && explicitId) {
    const { data, error } = await supabase
      .from("resume_versions")
      .select("*")
      .eq("id", explicitId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as ResumeVersion;
    // Attached resume was deleted — fall through to master.
  }

  const { data, error } = await supabase
    .from("resume_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("is_main", true)
    .maybeSingle();
  if (error) throw error;
  return (data as ResumeVersion) ?? null;
}

async function runScoreAndPersist(
  supabase: SupabaseClient,
  app: ScoreInputRow,
  resume: ResumeVersion | null,
  force: boolean
): Promise<ScoreResult> {
  // No resume anywhere — clear the fit fields so stale scores don't linger.
  if (!resume) {
    await supabase
      .from("applications")
      .update({
        resume_fit_score: null,
        resume_fit_details: null,
        resume_fit_scored_at: null,
        resume_fit_input_hash: null,
      })
      .eq("id", app.id);
    return { applicationId: app.id, outcome: "no_resume", score: null };
  }

  const hash = computeInputHash(
    { title: app.role.title, tags: app.role.tags, jd_body_text: app.role.jd_body_text },
    resume.id
  );

  if (!force && hash === app.resume_fit_input_hash) {
    return { applicationId: app.id, outcome: "cache_hit", score: null };
  }

  const result: ResumeFitResult = await scoreResumeFit({
    role: {
      title: app.role.title,
      tags: app.role.tags,
      jd_body_text: app.role.jd_body_text,
    },
    companyName: app.role.company?.name ?? null,
    resumeVersionId: resume.id,
    resumeExtractedText: resume.extracted_text,
  });

  // On llm_error we deliberately DO NOT overwrite the existing score —
  // preserves whatever was last known-good until the next attempt.
  if (result.skippedReason === "llm_error") {
    return { applicationId: app.id, outcome: "llm_error", score: null };
  }

  const scoredAt =
    result.skippedReason === null || result.skippedReason === "insufficient_text"
      ? new Date().toISOString()
      : null;

  await supabase
    .from("applications")
    .update({
      resume_fit_score: result.score,
      resume_fit_details: result.details,
      resume_fit_scored_at: scoredAt,
      resume_fit_input_hash: hash,
    })
    .eq("id", app.id);

  const outcome: ScoreOutcome =
    result.skippedReason === "insufficient_text"
      ? "insufficient_text"
      : "scored";

  return { applicationId: app.id, outcome, score: result.score };
}
