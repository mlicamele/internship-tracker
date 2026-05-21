// Role data-access.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfidenceTier,
  ExtractionSnapshot,
  RelocationAssistance,
  Role,
  RoleLocation,
  RoleSource,
  TargetSeason,
  WorkModel,
} from "./types";

export interface CreateRoleInput {
  companyId: string;
  title: string;
  locations?: RoleLocation[];
  jdUrl?: string | null;
  jdBodyText?: string | null;
  deadlineAt?: string | null;
  postedAt?: string | null;
  minGradYear?: number | null;
  maxGradYear?: number | null;
  relocationAssistance?: RelocationAssistance | null;
  source: RoleSource;
  sourceExternalId?: string | null;
  targetYear?: number | null;
  targetSeason?: TargetSeason;
  workModel?: WorkModel | null;
  compensationHourlyDollars?: number | null;
  extractionConfidences?: Record<string, ConfidenceTier>;
  extractionSnapshot?: ExtractionSnapshot;
}

const ROLE_INSERT_DEFAULTS = {
  target_season: "summer" as TargetSeason,
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
      locations: input.locations ?? [],
      jd_url: input.jdUrl ?? null,
      jd_body_text: input.jdBodyText ?? null,
      jd_snapshot_at: input.jdBodyText ? new Date().toISOString() : null,
      deadline_at: input.deadlineAt ?? null,
      posted_at: input.postedAt ?? null,
      min_grad_year: input.minGradYear ?? null,
      max_grad_year: input.maxGradYear ?? null,
      relocation_assistance: input.relocationAssistance ?? null,
      source: input.source,
      source_external_id: input.sourceExternalId ?? null,
      target_year: input.targetYear ?? null,
      target_season: input.targetSeason ?? ROLE_INSERT_DEFAULTS.target_season,
      work_model: input.workModel ?? null,
      compensation_hourly_dollars: input.compensationHourlyDollars ?? null,
      extraction_confidences: input.extractionConfidences ?? {},
      extraction_snapshot:
        input.extractionSnapshot ?? { values: {}, confidences: {} },
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Role;
}

export type RoleUpdate = Partial<{
  title: string;
  locations: RoleLocation[];
  jd_url: string | null;
  jd_body_text: string | null;
  deadline_at: string | null;
  posted_at: string | null;
  min_grad_year: number | null;
  max_grad_year: number | null;
  relocation_assistance: RelocationAssistance | null;
  target_year: number | null;
  target_season: TargetSeason;
  work_model: WorkModel | null;
  compensation_hourly_dollars: number | null;
  extraction_confidences: Record<string, ConfidenceTier>;
}>;

export async function updateRole(
  supabase: SupabaseClient,
  roleId: string,
  patch: RoleUpdate
): Promise<Role> {
  const { data, error } = await supabase
    .from("roles")
    .update(patch)
    .eq("id", roleId)
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
        locations: input.locations ?? [],
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
