// Status-event data-access. status_events are append-only — created by
// transitionStatus in lib/db/applications.ts. This file exposes reads.

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
