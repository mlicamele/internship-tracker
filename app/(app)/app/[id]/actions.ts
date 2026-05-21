"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getById,
  hardDelete,
  updateNotes,
} from "@/lib/db/applications";
import * as interviewsDb from "@/lib/db/interviews";
import * as companyNotesDb from "@/lib/db/company_notes";
import type { InterviewType } from "@/lib/db/types";

const INTERVIEW_TYPES: ReadonlySet<InterviewType> = new Set([
  "phone_screen",
  "technical",
  "behavioral",
  "system_design",
  "onsite",
  "final",
  "other",
]);

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
  return { supabase, user, application };
}

function revalidateDetail(applicationId: string) {
  revalidatePath(`/app/${applicationId}`);
  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  revalidatePath("/archive");
}

export async function updateNotesAction(
  applicationId: string,
  notes: string
) {
  const { supabase } = await requireOwnedApplication(applicationId);
  await updateNotes(supabase, applicationId, notes);
  revalidateDetail(applicationId);
}

export async function saveCompanyNotesAction(
  companyId: string,
  notes: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await companyNotesDb.upsert(supabase, user.id, companyId, notes);
}

function parseInterviewForm(formData: FormData) {
  const typeRaw = String(formData.get("type") ?? "");
  if (!INTERVIEW_TYPES.has(typeRaw as InterviewType)) {
    throw new Error(`Invalid interview type: ${typeRaw}`);
  }

  const scheduledAtRaw = String(formData.get("scheduled_at") ?? "").trim();
  const scheduledAt = scheduledAtRaw
    ? new Date(scheduledAtRaw).toISOString()
    : null;

  const durationRaw = String(formData.get("duration_minutes") ?? "").trim();
  const durationMinutes = durationRaw ? Number(durationRaw) : null;

  return {
    type: typeRaw as InterviewType,
    scheduledAt,
    durationMinutes:
      durationMinutes !== null && Number.isFinite(durationMinutes)
        ? durationMinutes
        : null,
    meetingUrl: (String(formData.get("meeting_url") ?? "").trim()) || null,
    location: (String(formData.get("location") ?? "").trim()) || null,
    interviewerNames:
      (String(formData.get("interviewer_names") ?? "").trim()) || null,
    notes: String(formData.get("notes") ?? ""),
    outcome: (String(formData.get("outcome") ?? "").trim()) || null,
  };
}

export async function createInterviewAction(
  applicationId: string,
  formData: FormData
) {
  const { supabase } = await requireOwnedApplication(applicationId);
  await interviewsDb.create(
    supabase,
    applicationId,
    parseInterviewForm(formData)
  );
  revalidateDetail(applicationId);
}

export async function updateInterviewAction(
  applicationId: string,
  interviewId: string,
  formData: FormData
) {
  const { supabase } = await requireOwnedApplication(applicationId);
  await interviewsDb.update(supabase, interviewId, parseInterviewForm(formData));
  revalidateDetail(applicationId);
}

export async function deleteInterviewAction(
  applicationId: string,
  interviewId: string
) {
  const { supabase } = await requireOwnedApplication(applicationId);
  await interviewsDb.remove(supabase, interviewId);
  revalidateDetail(applicationId);
}

export async function deleteApplicationAction(applicationId: string) {
  const { supabase } = await requireOwnedApplication(applicationId);
  await hardDelete(supabase, applicationId);
  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  revalidatePath("/archive");
  redirect("/pipeline");
}
