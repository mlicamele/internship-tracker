"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getById, setTriageState } from "@/lib/db/applications";
import {
  rescoreInboxAgainstResume,
  rescoreResumeFitBatch,
  scoreAndPersistResumeFit,
} from "@/lib/db/resume-fit";
import type { TriageState } from "@/lib/db/types";

export type TriageAction = "apply" | "snooze" | "skip";

function snoozeUntil(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function requireOwnedApplication(applicationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const application = await getById(supabase, applicationId);
  if (!application || application.user_id !== user.id) {
    notFound();
  }
  return { supabase, user };
}

export async function triageAction(
  applicationId: string,
  action: TriageAction,
  snoozeDays?: number
) {
  const { supabase } = await requireOwnedApplication(applicationId);

  let next: TriageState;
  let snoozeIso: string | null = null;

  switch (action) {
    case "apply":
      next = "active";
      break;
    case "skip":
      next = "skipped";
      break;
    case "snooze":
      next = "snoozed";
      snoozeIso = snoozeUntil(snoozeDays ?? 7);
      break;
  }

  await setTriageState(supabase, applicationId, next, snoozeIso);
  // Effective resume flips (main-only → attached-or-main) when moving
  // out of inbox, so the resume-fit hash changes and a rescore is warranted.
  // Non-force + cache-hash means no-ops (e.g. inbox → skipped, then back)
  // don't burn Groq calls. Skipped apps aren't in the rescore-eligible set
  // downstream, so scoring one on the way to skipped is wasted but harmless.
  if (next !== "skipped") {
    try {
      await scoreAndPersistResumeFit(supabase, applicationId);
    } catch (err) {
      console.error("resume-fit rescore after triage failed:", err);
    }
  }
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  revalidatePath("/archive");
}

/**
 * Force every inbox app to be scored against a specific resume version.
 * Blocks until the batch finishes so the user sees the fresh scores on
 * the redirect. `resumeVersionId` may be null to fall back to the default
 * (main) triage-scoring behavior — in that case we still rescore against
 * main so scores match the picker's implicit selection.
 */
export async function setTriageResumeAction(
  resumeVersionId: string | null
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (resumeVersionId) {
    // Validate the picked resume belongs to this user before batching.
    const { data } = await supabase
      .from("resume_versions")
      .select("id")
      .eq("id", resumeVersionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) resumeVersionId = null;
  }

  if (resumeVersionId) {
    try {
      await rescoreInboxAgainstResume(supabase, user.id, resumeVersionId);
    } catch (err) {
      console.error("triage picker rescore failed:", err);
    }
  } else {
    // Picker cleared — rescore inbox against main (the normal default).
    const { data } = await supabase
      .from("resume_versions")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_main", true)
      .maybeSingle();
    if (data) {
      try {
        await rescoreInboxAgainstResume(supabase, user.id, (data as { id: string }).id);
      } catch (err) {
        console.error("triage picker main-rescore failed:", err);
      }
    }
  }

  revalidatePath("/inbox");
}

/**
 * Score every inbox application that currently has no resume-fit score
 * (typically: legacy rows added before scoring code, or rows whose earlier
 * scoring call failed). Uses the batch runner which respects the process-wide
 * Groq rate limiter, so 15+ rows won't overwhelm the free tier.
 *
 * Returns { rescored, alreadyScored, noResume } counts so the UI can surface
 * "N newly scored" instead of a silent success.
 */
export async function rescoreUnscoredInboxAction(): Promise<{
  rescored: number;
  alreadyScored: number;
  noResume: number;
  errors: number;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", user.id)
    .eq("triage_state", "inbox")
    .is("resume_fit_scored_at", null);
  if (error) throw error;

  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) {
    return { rescored: 0, alreadyScored: 0, noResume: 0, errors: 0 };
  }

  const results = await rescoreResumeFitBatch(supabase, ids);
  let rescored = 0;
  let alreadyScored = 0;
  let noResume = 0;
  let errors = 0;
  for (const r of results) {
    if (r.outcome === "scored" || r.outcome === "insufficient_text") rescored++;
    else if (r.outcome === "cache_hit") alreadyScored++;
    else if (r.outcome === "no_resume") noResume++;
    else errors++;
  }
  revalidatePath("/inbox");
  return { rescored, alreadyScored, noResume, errors };
}

export async function resetToInboxAction(applicationId: string) {
  const { supabase } = await requireOwnedApplication(applicationId);
  await setTriageState(supabase, applicationId, "inbox", null);
  // Now scoring against main again — rescore.
  try {
    await scoreAndPersistResumeFit(supabase, applicationId);
  } catch (err) {
    console.error("resume-fit rescore after reset failed:", err);
  }
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  revalidatePath("/archive");
}
