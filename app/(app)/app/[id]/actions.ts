"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getById,
  hardDelete,
  setTriageState,
  updateNotes,
} from "@/lib/db/applications";
import * as interviewsDb from "@/lib/db/interviews";
import * as companyNotesDb from "@/lib/db/company_notes";
import { renameCompany, updateCompany } from "@/lib/db/companies";
import { updateRole, type RoleUpdate } from "@/lib/db/roles";
import { geocode } from "@/lib/geocode";
import type {
  InterviewType,
  RelocationAssistance,
  RoleLocation,
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

const RELOCATION_VALUES: ReadonlySet<RelocationAssistance> = new Set([
  "provided",
  "not_provided",
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

export async function getCompanyNotesAction(
  companyId: string
): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const row = await companyNotesDb.get(supabase, user.id, companyId);
  return row?.notes ?? "";
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
  | "locations"
  | "deadline_at"
  | "posted_at"
  | "min_grad_year"
  | "max_grad_year"
  | "relocation_assistance"
  | "target_year"
  | "target_season"
  | "work_model"
  | "compensation_hourly_dollars";

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
    case "locations": {
      // Accept newline- or comma-separated input from the editor
      const raw = rawValue ?? "";
      const items = raw
        .split(/[\n,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const seen = new Set<string>();
      const next: RoleLocation[] = [];
      for (const text of items) {
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        let lat: number | null = null;
        let lng: number | null = null;
        try {
          const coords = await geocode(text);
          if (coords) {
            lat = coords.lat;
            lng = coords.lng;
          }
        } catch {
          // ignore — leave coords null
        }
        next.push({ text, lat, lng });
      }
      patch.locations = next;
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
    case "min_grad_year": {
      const v = emptyToNull(rawValue ?? "");
      if (v === null) {
        patch.min_grad_year = null;
      } else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 2024 || n > 2034) {
          return { ok: false, error: "Grad year must be 2024–2034" };
        }
        patch.min_grad_year = n;
      }
      break;
    }
    case "max_grad_year": {
      const v = emptyToNull(rawValue ?? "");
      if (v === null) {
        patch.max_grad_year = null;
      } else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 2024 || n > 2034) {
          return { ok: false, error: "Grad year must be 2024–2034" };
        }
        patch.max_grad_year = n;
      }
      break;
    }
    case "relocation_assistance": {
      const v = emptyToNull(rawValue ?? "");
      if (v === null) {
        patch.relocation_assistance = null;
      } else if (RELOCATION_VALUES.has(v as RelocationAssistance)) {
        patch.relocation_assistance = v as RelocationAssistance;
      } else {
        return { ok: false, error: "Invalid relocation value" };
      }
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
      const v = emptyToNull(rawValue ?? "");
      if (v === null) {
        patch.work_model = null;
      } else if (WORK_MODEL_VALUES.has(v as WorkModel)) {
        patch.work_model = v as WorkModel;
      } else {
        return { ok: false, error: "Invalid work model" };
      }
      break;
    }
    case "compensation_hourly_dollars": {
      const v = emptyToNull(rawValue ?? "");
      if (v === null) {
        patch.compensation_hourly_dollars = null;
      } else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 9999) {
          return { ok: false, error: "Enter dollars per hour (0–9999)" };
        }
        patch.compensation_hourly_dollars = Math.round(n);
      }
      break;
    }
  }

  // Manual edit invalidates the LLM's confidence for this field — strip the key.
  const currentConfidences =
    (application.role.extraction_confidences as
      | Record<string, import("@/lib/db/types").ConfidenceTier>
      | undefined) ?? {};
  if (field in currentConfidences) {
    const next = { ...currentConfidences };
    delete next[field];
    patch.extraction_confidences = next;
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

export type CompanyEditableField = "industry_tags" | "hq_city";

export async function updateCompanyFieldAction(
  applicationId: string,
  field: CompanyEditableField,
  rawValue: string | null
): Promise<InlineEditResult> {
  const { supabase, application } = await requireOwnedApplication(applicationId);
  const companyId = application.role.company.id;

  if (field === "industry_tags") {
    const tags = (rawValue ?? "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const unique = Array.from(new Set(tags));
    try {
      await updateCompany(supabase, companyId, { industry_tags: unique });
      revalidateDetail(applicationId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to save tags",
      };
    }
  }

  if (field === "hq_city") {
    const v = (rawValue ?? "").trim() || null;
    let hq_lat: number | null = null;
    let hq_lng: number | null = null;
    if (v) {
      try {
        const coords = await geocode(v);
        hq_lat = coords?.lat ?? null;
        hq_lng = coords?.lng ?? null;
      } catch {
        // ignore
      }
    }
    try {
      await updateCompany(supabase, companyId, {
        hq_city: v,
        hq_lat,
        hq_lng,
      });
      revalidateDetail(applicationId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to save",
      };
    }
  }

  return { ok: false, error: `Unknown field: ${field}` };
}

/**
 * Flip a draft application to "active" (the normal pipeline state) after the
 * user has reviewed the auto-extracted data and clicked Save. No-op for
 * applications that aren't drafts.
 */
export async function commitDraftAction(
  applicationId: string
): Promise<InlineEditResult> {
  const { supabase, application } = await requireOwnedApplication(applicationId);
  if (application.triage_state !== "draft") return { ok: true };
  try {
    await setTriageState(supabase, applicationId, "active");
    revalidateDetail(applicationId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to commit draft",
    };
  }
}

/**
 * Revert a single role field to its frozen extraction-snapshot value. Restores
 * the original confidence tier so the field re-appears as auto-extracted.
 * No-op if the snapshot doesn't have a value for this field.
 */
export async function revertRoleFieldAction(
  applicationId: string,
  field: RoleEditableField
): Promise<InlineEditResult> {
  const { supabase, application } = await requireOwnedApplication(applicationId);
  const snapshot = application.role.extraction_snapshot ?? {
    values: {},
    confidences: {},
  };
  const snapshotValues = (snapshot.values ?? {}) as Record<string, unknown>;
  const snapshotConfidences = (snapshot.confidences ?? {}) as Record<
    string,
    import("@/lib/db/types").ConfidenceTier
  >;

  if (!(field in snapshotValues)) {
    return { ok: false, error: "No extraction snapshot for this field" };
  }

  const patch: RoleUpdate = {};
  const snap = snapshotValues[field];

  switch (field) {
    case "title":
      patch.title = typeof snap === "string" ? snap : "Untitled role";
      break;
    case "locations": {
      // Snapshot stores locations as string[] of texts; re-geocode each
      const texts = Array.isArray(snap) ? (snap as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const next: RoleLocation[] = [];
      for (const text of texts) {
        let lat: number | null = null;
        let lng: number | null = null;
        try {
          const coords = await geocode(text);
          lat = coords?.lat ?? null;
          lng = coords?.lng ?? null;
        } catch {
          // ignore
        }
        next.push({ text, lat, lng });
      }
      patch.locations = next;
      break;
    }
    case "deadline_at":
      patch.deadline_at = typeof snap === "string" ? snap : null;
      break;
    case "posted_at":
      patch.posted_at = typeof snap === "string" ? snap : null;
      break;
    case "min_grad_year":
      patch.min_grad_year = typeof snap === "number" ? snap : null;
      break;
    case "max_grad_year":
      patch.max_grad_year = typeof snap === "number" ? snap : null;
      break;
    case "target_year":
      patch.target_year = typeof snap === "number" ? snap : null;
      break;
    case "target_season":
      if (TARGET_SEASON_VALUES.has(snap as TargetSeason)) {
        patch.target_season = snap as TargetSeason;
      }
      break;
    case "work_model":
      if (snap === null) patch.work_model = null;
      else if (WORK_MODEL_VALUES.has(snap as WorkModel)) {
        patch.work_model = snap as WorkModel;
      }
      break;
    case "relocation_assistance":
      if (snap === null) patch.relocation_assistance = null;
      else if (RELOCATION_VALUES.has(snap as RelocationAssistance)) {
        patch.relocation_assistance = snap as RelocationAssistance;
      }
      break;
    case "compensation_hourly_dollars":
      patch.compensation_hourly_dollars = typeof snap === "number" ? snap : null;
      break;
    default:
      return { ok: false, error: `Cannot revert ${field}` };
  }

  // Restore the original confidence tier for this field
  if (field in snapshotConfidences) {
    const currentConfidences =
      (application.role.extraction_confidences as
        | Record<string, import("@/lib/db/types").ConfidenceTier>
        | undefined) ?? {};
    patch.extraction_confidences = {
      ...currentConfidences,
      [field]: snapshotConfidences[field],
    };
  }

  try {
    await updateRole(supabase, application.role_id, patch);
    revalidateDetail(applicationId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to revert",
    };
  }
}
