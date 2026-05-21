"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getById, setTriageState } from "@/lib/db/applications";
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
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  revalidatePath("/archive");
}
