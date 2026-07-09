"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getById, setTriageState } from "@/lib/db/applications";
import {
  rescoreInboxAgainstResume,
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
  // Effective resume flips (master-only → attached-or-master) when moving
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
 * (master) triage-scoring behavior — in that case we still rescore against
 * master so scores match the picker's implicit selection.
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
    // Picker cleared — rescore inbox against master (the normal default).
    const { data } = await supabase
      .from("resume_versions")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_master", true)
      .maybeSingle();
    if (data) {
      try {
        await rescoreInboxAgainstResume(supabase, user.id, (data as { id: string }).id);
      } catch (err) {
        console.error("triage picker master-rescore failed:", err);
      }
    }
  }

  revalidatePath("/inbox");
}

export async function resetToInboxAction(applicationId: string) {
  const { supabase } = await requireOwnedApplication(applicationId);
  await setTriageState(supabase, applicationId, "inbox", null);
  // Now scoring against master again — rescore.
  try {
    await scoreAndPersistResumeFit(supabase, applicationId);
  } catch (err) {
    console.error("resume-fit rescore after reset failed:", err);
  }
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  revalidatePath("/archive");
}
