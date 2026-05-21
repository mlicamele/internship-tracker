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
import { renameCompany } from "@/lib/db/companies";
import { updateRole, type RoleUpdate } from "@/lib/db/roles";
import { parseCompensation } from "@/lib/comp/parse";
import { geocode } from "@/lib/geocode";
import type {
  ClassYearTag,
  InterviewType,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";

const INTERVIEW_TYPES: ReadonlySet<InterviewType> = new Set([
  "phone_screen",
  "technical",
  "behavioral",
  "system_design",
  "onsite",
  "final",
  "other",
]);

const CLASS_YEAR_VALUES: ReadonlySet<ClassYearTag> = new Set([
  "freshman_ok",
  "sophomore_ok",
  "junior_plus",
  "unspecified",
]);

const TARGET_SEASON_VALUES: ReadonlySet<TargetSeason> = new Set([
  "summer",
  "fall",
  "winter",
  "spring",
]);

const WORK_MODEL_VALUES: ReadonlySet<WorkModel> = new Set([
  "remote",
  "hybrid",
  "onsite",
  "unspecified",
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

// ---------- Inline edit (Phase 2.5 Bundle 1) ----------

export type RoleEditableField =
  | "title"
  | "location_text"
  | "deadline_at"
  | "posted_at"
  | "class_year_tag"
  | "target_year"
  | "target_season"
  | "work_model"
  | "compensation_text";

export type InlineEditResult =
  | { ok: true }
  | { ok: false; error: string };

function emptyToNull(v: string): string | null {
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function dateInputToIso(v: string | null): string | null {
  if (!v) return null;
  return `${v}T00:00:00Z`;
}

export async function updateRoleFieldAction(
  applicationId: string,
  field: RoleEditableField,
  rawValue: string | null
): Promise<InlineEditResult> {
  const { supabase, application } = await requireOwnedApplication(applicationId);

  const patch: RoleUpdate = {};

  switch (field) {
    case "title": {
      const v = emptyToNull(rawValue ?? "");
      if (!v) return { ok: false, error: "Title cannot be empty" };
      patch.title = v;
      break;
    }
    case "location_text": {
      const v = emptyToNull(rawValue ?? "");
      patch.location_text = v;
      if (v) {
        try {
          const coords = await geocode(v);
          patch.role_lat = coords?.lat ?? null;
          patch.role_lng = coords?.lng ?? null;
        } catch {
          patch.role_lat = null;
          patch.role_lng = null;
        }
      } else {
        patch.role_lat = null;
        patch.role_lng = null;
      }
      break;
    }
    case "deadline_at": {
      patch.deadline_at = dateInputToIso(emptyToNull(rawValue ?? ""));
      break;
    }
    case "posted_at": {
      patch.posted_at = dateInputToIso(emptyToNull(rawValue ?? ""));
      break;
    }
    case "class_year_tag": {
      const v = (rawValue ?? "unspecified") as ClassYearTag;
      if (!CLASS_YEAR_VALUES.has(v)) {
        return { ok: false, error: "Invalid class year" };
      }
      patch.class_year_tag = v;
      // Manual edits clear confidence (no longer auto-detected)
      patch.class_year_confidence = null;
      break;
    }
    case "target_year": {
      const v = emptyToNull(rawValue ?? "");
      if (v === null) {
        patch.target_year = null;
      } else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 2024 || n > 2032) {
          return { ok: false, error: "Target year must be 2024–2032" };
        }
        patch.target_year = n;
      }
      break;
    }
    case "target_season": {
      const v = (rawValue ?? "summer") as TargetSeason;
      if (!TARGET_SEASON_VALUES.has(v)) {
        return { ok: false, error: "Invalid target season" };
      }
      patch.target_season = v;
      break;
    }
    case "work_model": {
      const v = (rawValue ?? "unspecified") as WorkModel;
      if (!WORK_MODEL_VALUES.has(v)) {
        return { ok: false, error: "Invalid work model" };
      }
      patch.work_model = v;
      break;
    }
    case "compensation_text": {
      const v = emptyToNull(rawValue ?? "");
      patch.compensation_text = v;
      if (v) {
        const parsed = parseCompensation(v);
        patch.compensation_hourly_cents = parsed.hourlyCents;
      } else {
        patch.compensation_hourly_cents = null;
      }
      break;
    }
  }

  try {
    await updateRole(supabase, application.role_id, patch);
    revalidateDetail(applicationId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save",
    };
  }
}

export async function updateCompanyNameAction(
  applicationId: string,
  newName: string
): Promise<InlineEditResult> {
  const { supabase, application } = await requireOwnedApplication(applicationId);
  const name = newName.trim();
  if (!name) return { ok: false, error: "Company name cannot be empty" };

  const result = await renameCompany(supabase, application.role.company.id, name);
  if ("error" in result) {
    return { ok: false, error: "Another company already uses that name" };
  }
  revalidateDetail(applicationId);
  return { ok: true };
}
