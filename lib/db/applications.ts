// Application data-access.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Application,
  ApplicationStatus,
  Company,
  Interview,
  Role,
  TriageState,
} from "./types";

/** Application joined with its role + company + interviews for list views. */
export interface ApplicationRow extends Application {
  role: Role & { company: Pick<Company, "id" | "name" | "industry_tags"> };
  interviews: Pick<Interview, "id" | "type" | "scheduled_at" | "meeting_url">[];
  /** Derived: the soonest upcoming interview (or undated). Null if none. */
  next_interview: Pick<Interview, "id" | "type" | "scheduled_at" | "meeting_url"> | null;
}

export interface CreateApplicationInput {
  userId: string;
  roleId: string;
  triageState?: TriageState;
  fitScore?: number;
  notes?: string;
}

const APP_WITH_RELATIONS_SELECT = `
  *,
  role:roles(
    *,
    company:companies(id, name, industry_tags)
  ),
  interviews(id, type, scheduled_at, meeting_url)
`;

function withNextInterview(app: Omit<ApplicationRow, "next_interview">): ApplicationRow {
  const now = Date.now();
  const upcoming = [...(app.interviews ?? [])]
    .filter((i) => !i.scheduled_at || new Date(i.scheduled_at).getTime() >= now)
    .sort((a, b) => {
      // undated rows sort last
      if (!a.scheduled_at && !b.scheduled_at) return 0;
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });
  return { ...app, next_interview: upcoming[0] ?? null };
}

export async function createApplication(
  supabase: SupabaseClient,
  input: CreateApplicationInput
): Promise<Application> {
  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: input.userId,
      role_id: input.roleId,
      triage_state: input.triageState ?? "active",
      status: "saved",
      notes: input.notes ?? "",
      fit_score: input.fitScore ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;

  // Seed a status_events row so the timeline shows when the app was created.
  await supabase.from("status_events").insert({
    application_id: data.id,
    from_status: null,
    to_status: "saved",
    note: "Application created",
  });

  return data as Application;
}

export async function transitionStatus(
  supabase: SupabaseClient,
  applicationId: string,
  toStatus: ApplicationStatus,
  note?: string
): Promise<Application> {
  // Read current status first so we can log the transition
  const { data: current, error: readError } = await supabase
    .from("applications")
    .select("status")
    .eq("id", applicationId)
    .single();
  if (readError) throw readError;

  const { data, error } = await supabase
    .from("applications")
    .update({ status: toStatus })
    .eq("id", applicationId)
    .select("*")
    .single();
  if (error) throw error;

  if (current.status !== toStatus) {
    await supabase.from("status_events").insert({
      application_id: applicationId,
      from_status: current.status,
      to_status: toStatus,
      note: note ?? null,
    });
  }

  return data as Application;
}

export async function updateNotes(
  supabase: SupabaseClient,
  applicationId: string,
  notes: string
): Promise<Application> {
  const { data, error } = await supabase
    .from("applications")
    .update({ notes })
    .eq("id", applicationId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Application;
}

export async function setResumeVersion(
  supabase: SupabaseClient,
  applicationId: string,
  resumeVersionId: string | null
): Promise<Application> {
  const { data, error } = await supabase
    .from("applications")
    .update({ resume_version_id: resumeVersionId })
    .eq("id", applicationId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Application;
}

export async function setTriageState(
  supabase: SupabaseClient,
  applicationId: string,
  state: TriageState,
  snoozedUntil?: string | null
): Promise<Application> {
  const patch: Partial<Application> = { triage_state: state };
  if (state === "snoozed" && snoozedUntil) {
    patch.snoozed_until = snoozedUntil;
  } else if (state !== "snoozed") {
    patch.snoozed_until = null;
  }
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("id", applicationId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Application;
}

export async function listByTriageState(
  supabase: SupabaseClient,
  userId: string,
  states: TriageState | TriageState[]
): Promise<ApplicationRow[]> {
  const stateList = Array.isArray(states) ? states : [states];
  const { data, error } = await supabase
    .from("applications")
    .select(APP_WITH_RELATIONS_SELECT)
    .eq("user_id", userId)
    .in("triage_state", stateList)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((app) =>
    withNextInterview(app as unknown as Omit<ApplicationRow, "next_interview">)
  );
}

export async function getById(
  supabase: SupabaseClient,
  applicationId: string
): Promise<ApplicationRow | null> {
  const { data, error } = await supabase
    .from("applications")
    .select(APP_WITH_RELATIONS_SELECT)
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return withNextInterview(data as unknown as Omit<ApplicationRow, "next_interview">);
}

export async function softDelete(
  supabase: SupabaseClient,
  applicationId: string
): Promise<void> {
  await setTriageState(supabase, applicationId, "skipped");
}

export async function hardDelete(
  supabase: SupabaseClient,
  applicationId: string
): Promise<void> {
  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId);
  if (error) throw error;
}

/** Phase 3 plugs in real scoring. Stub returns void. */
export async function recomputeFitScores(
  _supabase: SupabaseClient,
  _userId: string
): Promise<void> {
  // No-op until Phase 3 Track 3-A.
}
