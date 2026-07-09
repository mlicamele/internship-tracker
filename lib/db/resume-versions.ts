// Resume-version data-access. Each function takes a Supabase client so callers
// can use either the cookie-bound server client (server actions / RSC) or the
// service-role client (upload API route).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResumeVersion } from "./types";

export interface ResumeVersionInsert {
  id?: string;
  user_id: string;
  label: string;
  storage_path: string;
  file_size_bytes: number | null;
  mime_type: string;
  extracted_text: string | null;
  is_master: boolean;
}

export async function listResumeVersions(
  supabase: SupabaseClient,
  userId: string
): Promise<ResumeVersion[]> {
  const { data, error } = await supabase
    .from("resume_versions")
    .select("*")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ResumeVersion[];
}

export async function getMasterResumeVersion(
  supabase: SupabaseClient,
  userId: string
): Promise<ResumeVersion | null> {
  const { data, error } = await supabase
    .from("resume_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("is_master", true)
    .maybeSingle();

  if (error) throw error;
  return data as ResumeVersion | null;
}

export async function createResumeVersion(
  supabase: SupabaseClient,
  input: ResumeVersionInsert
): Promise<ResumeVersion> {
  const { data, error } = await supabase
    .from("resume_versions")
    .insert(input)
    .select("*")
    .single();

  if (error) throw error;
  return data as ResumeVersion;
}

export async function deleteResumeVersion(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("resume_versions")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  if (error) throw error;
}

// Single UPDATE via RPC so the partial unique index (user_id) WHERE is_master
// evaluates at statement end rather than per-row. See migration 0015.
export async function setMasterResumeVersion(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<void> {
  const { error } = await supabase.rpc("set_master_resume_version", {
    target_user_id: userId,
    target_id: id,
  });

  if (error) throw error;
}
