// Role data-access.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClassYearTag,
  Role,
  RoleSource,
  TargetSeason,
  WorkModel,
} from "./types";

export interface CreateRoleInput {
  companyId: string;
  title: string;
  locationText?: string | null;
  roleLat?: number | null;
  roleLng?: number | null;
  jdUrl?: string | null;
  jdBodyText?: string | null;
  deadlineAt?: string | null;
  postedAt?: string | null;
  classYearTag?: ClassYearTag;
  classYearConfidence?: number | null;
  source: RoleSource;
  sourceExternalId?: string | null;
  targetYear?: number | null;
  targetSeason?: TargetSeason;
  workModel?: WorkModel;
  compensationText?: string | null;
  compensationHourlyCents?: number | null;
}

const ROLE_INSERT_DEFAULTS = {
  target_season: "summer" as TargetSeason,
  work_model: "unspecified" as WorkModel,
  class_year_tag: "unspecified" as ClassYearTag,
};

export async function create(
  supabase: SupabaseClient,
  input: CreateRoleInput
): Promise<Role> {
  const { data, error } = await supabase
    .from("roles")
    .insert({
      company_id: input.companyId,
      title: input.title,
      location_text: input.locationText ?? null,
      role_lat: input.roleLat ?? null,
      role_lng: input.roleLng ?? null,
      jd_url: input.jdUrl ?? null,
      jd_body_text: input.jdBodyText ?? null,
      jd_snapshot_at: input.jdBodyText ? new Date().toISOString() : null,
      deadline_at: input.deadlineAt ?? null,
      posted_at: input.postedAt ?? null,
      class_year_tag: input.classYearTag ?? ROLE_INSERT_DEFAULTS.class_year_tag,
      class_year_confidence: input.classYearConfidence ?? null,
      source: input.source,
      source_external_id: input.sourceExternalId ?? null,
      target_year: input.targetYear ?? null,
      target_season: input.targetSeason ?? ROLE_INSERT_DEFAULTS.target_season,
      work_model: input.workModel ?? ROLE_INSERT_DEFAULTS.work_model,
      compensation_text: input.compensationText ?? null,
      compensation_hourly_cents: input.compensationHourlyCents ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Role;
}

export async function getById(
  supabase: SupabaseClient,
  roleId: string
): Promise<Role | null> {
  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .eq("id", roleId)
    .maybeSingle();
  if (error) throw error;
  return data as Role | null;
}

/** Upsert by (source, source_external_id). Used by the Phase 5 scraper. */
export async function upsertBySourceId(
  supabase: SupabaseClient,
  input: CreateRoleInput
): Promise<Role> {
  if (!input.sourceExternalId) {
    throw new Error("upsertBySourceId requires sourceExternalId");
  }

  // Find existing by (source, source_external_id)
  const { data: existing, error: readError } = await supabase
    .from("roles")
    .select("*")
    .eq("source", input.source)
    .eq("source_external_id", input.sourceExternalId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    // Update mutable fields (deadline may have shifted, JD body may have been re-fetched)
    const { data, error } = await supabase
      .from("roles")
      .update({
        title: input.title,
        location_text: input.locationText ?? null,
        role_lat: input.roleLat ?? null,
        role_lng: input.roleLng ?? null,
        jd_url: input.jdUrl ?? existing.jd_url,
        jd_body_text: input.jdBodyText ?? existing.jd_body_text,
        deadline_at: input.deadlineAt ?? existing.deadline_at,
        posted_at: input.postedAt ?? existing.posted_at,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as Role;
  }
  return create(supabase, input);
}
