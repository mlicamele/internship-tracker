// Per-user notes about a company (separate from per-application notes).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyNote } from "./types";

export async function get(
  supabase: SupabaseClient,
  userId: string,
  companyId: string
): Promise<CompanyNote | null> {
  const { data, error } = await supabase
    .from("company_notes")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data as CompanyNote | null;
}

export async function upsert(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  notes: string
): Promise<CompanyNote> {
  const { data, error } = await supabase
    .from("company_notes")
    .upsert(
      { user_id: userId, company_id: companyId, notes },
      { onConflict: "user_id,company_id" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as CompanyNote;
}
