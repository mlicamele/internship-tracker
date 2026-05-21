// Interview data-access. Per-application data capture; prep tracking is V2.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Interview, InterviewType } from "./types";

export interface InterviewInput {
  type: InterviewType;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  meetingUrl?: string | null;
  location?: string | null;
  interviewerNames?: string | null;
  notes?: string;
  outcome?: string | null;
}

function toDbRow(input: InterviewInput) {
  return {
    type: input.type,
    scheduled_at: input.scheduledAt ?? null,
    duration_minutes: input.durationMinutes ?? null,
    meeting_url: input.meetingUrl ?? null,
    location: input.location ?? null,
    interviewer_names: input.interviewerNames ?? null,
    notes: input.notes ?? "",
    outcome: input.outcome ?? null,
  };
}

export async function create(
  supabase: SupabaseClient,
  applicationId: string,
  input: InterviewInput
): Promise<Interview> {
  const { data, error } = await supabase
    .from("interviews")
    .insert({ application_id: applicationId, ...toDbRow(input) })
    .select("*")
    .single();
  if (error) throw error;
  return data as Interview;
}

export async function update(
  supabase: SupabaseClient,
  interviewId: string,
  input: InterviewInput
): Promise<Interview> {
  const { data, error } = await supabase
    .from("interviews")
    .update(toDbRow(input))
    .eq("id", interviewId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Interview;
}

export async function remove(
  supabase: SupabaseClient,
  interviewId: string
): Promise<void> {
  const { error } = await supabase
    .from("interviews")
    .delete()
    .eq("id", interviewId);
  if (error) throw error;
}

export async function listForApplication(
  supabase: SupabaseClient,
  applicationId: string
): Promise<Interview[]> {
  const { data, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("application_id", applicationId)
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Interview[];
}
