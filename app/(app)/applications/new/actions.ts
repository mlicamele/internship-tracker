"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  findOrCreate as findOrCreateCompany,
} from "@/lib/db/companies";
import { create as createRole } from "@/lib/db/roles";
import { createApplication } from "@/lib/db/applications";
import { geocode } from "@/lib/geocode";
import type {
  ClassYearTag,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";

const WORK_MODEL_VALUES: ReadonlySet<WorkModel> = new Set([
  "remote",
  "hybrid",
  "onsite",
  "unspecified",
]);

const TARGET_SEASON_VALUES: ReadonlySet<TargetSeason> = new Set([
  "summer",
  "fall",
  "winter",
  "spring",
]);

const CLASS_YEAR_VALUES: ReadonlySet<ClassYearTag> = new Set([
  "freshman_ok",
  "sophomore_ok",
  "junior_plus",
  "unspecified",
]);

function fail(message: string): never {
  redirect(`/applications/new?error=${encodeURIComponent(message)}`);
}

function str(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function date(formData: FormData, name: string): string | null {
  const raw = str(formData, name);
  if (!raw) return null;
  // HTML date input is YYYY-MM-DD; Supabase wants ISO timestamp
  return `${raw}T00:00:00Z`;
}

function int(formData: FormData, name: string): number | null {
  const raw = str(formData, name);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export async function saveNewApplication(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Required
  const companyName = str(formData, "company");
  const roleTitle = str(formData, "role_title");
  const targetYear = int(formData, "target_year");
  if (!companyName) fail("Company is required");
  if (!roleTitle) fail("Role title is required");
  if (
    targetYear === null ||
    !Number.isInteger(targetYear) ||
    targetYear < 2024 ||
    targetYear > 2032
  ) {
    fail("Target year must be between 2024 and 2032");
  }

  // Enums (validated)
  const workModelRaw = str(formData, "work_model") ?? "unspecified";
  if (!WORK_MODEL_VALUES.has(workModelRaw as WorkModel)) fail("Invalid work model");
  const workModel = workModelRaw as WorkModel;

  const targetSeasonRaw = str(formData, "target_season") ?? "summer";
  if (!TARGET_SEASON_VALUES.has(targetSeasonRaw as TargetSeason)) {
    fail("Invalid target season");
  }
  const targetSeason = targetSeasonRaw as TargetSeason;

  const classYearRaw = str(formData, "class_year_tag") ?? "unspecified";
  if (!CLASS_YEAR_VALUES.has(classYearRaw as ClassYearTag)) {
    fail("Invalid class year tag");
  }
  const classYearTag = classYearRaw as ClassYearTag;

  // Optional
  const locationText = str(formData, "location_text");
  const jdUrl = str(formData, "jd_url");
  const jdBodyText = str(formData, "jd_body_text");
  const deadlineAt = date(formData, "deadline_at");
  const postedAt = date(formData, "posted_at");
  const compensationText = str(formData, "compensation_text");
  const compensationHourlyCents = int(formData, "compensation_hourly_cents");
  const notes = str(formData, "notes") ?? "";

  // Geocode location (best-effort)
  let roleLat: number | null = null;
  let roleLng: number | null = null;
  if (locationText) {
    try {
      const coords = await geocode(locationText);
      if (coords) {
        roleLat = coords.lat;
        roleLng = coords.lng;
      }
    } catch {
      // Geocode failure shouldn't block creation
    }
  }

  // 1. Find-or-create company
  const company = await findOrCreateCompany(supabase, companyName);

  // 2. Create role
  const role = await createRole(supabase, {
    companyId: company.id,
    title: roleTitle,
    locationText,
    roleLat,
    roleLng,
    jdUrl,
    jdBodyText,
    deadlineAt,
    postedAt,
    classYearTag,
    workModel,
    targetYear,
    targetSeason,
    compensationText,
    compensationHourlyCents,
    source: "manual",
  });

  // 3. Create application
  const application = await createApplication(supabase, {
    userId: user.id,
    roleId: role.id,
    notes,
    triageState: "active",
  });

  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  redirect(`/app/${application.id}`);
}
