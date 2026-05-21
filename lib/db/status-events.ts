// Status-event data-access. status_events are normally appended by
// transitionStatus in lib/db/applications.ts. Users can manually delete
// individual events for cleanup.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatusEvent } from "./types";

export async function listForApplication(
  supabase: SupabaseClient,
  applicationId: string
): Promise<StatusEvent[]> {
  const { data, error } = await supabase
    .from("status_events")
    .select("*")
    .eq("application_id", applicationId)
    .order("occurred_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StatusEvent[];
}

export async function deleteStatusEvent(
  supabase: SupabaseClient,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from("status_events")
    .delete()
    .eq("id", eventId);
  if (error) throw error;
}
