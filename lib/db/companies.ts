// Company data-access.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company } from "./types";

/** Normalize a company name for dedup (lowercase, strip suffixes, trim). */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc\.?|llc|ltd\.?|co\.?|corp\.?|corporation|limited)\b/gi, "")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Return existing company by normalized name or insert a new one. */
export async function findOrCreate(
  supabase: SupabaseClient,
  name: string
): Promise<Company> {
  const normalized = normalize(name);
  if (!normalized) throw new Error("Company name cannot be empty");

  const { data: existing, error: readError } = await supabase
    .from("companies")
    .select("*")
    .eq("normalized_name", normalized)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing as Company;

  const { data, error } = await supabase
    .from("companies")
    .insert({ name: name.trim(), normalized_name: normalized })
    .select("*")
    .single();
  if (error) throw error;
  return data as Company;
}

/**
 * Rename a company. If the new name normalizes to an existing company,
 * the rename is rejected (caller should surface error or implement merge).
 */
export async function renameCompany(
  supabase: SupabaseClient,
  companyId: string,
  newName: string
): Promise<Company | { error: "name_conflict" }> {
  const normalized = normalize(newName);
  if (!normalized) throw new Error("Company name cannot be empty");

  // Check if another company already owns this normalized name
  const { data: conflict } = await supabase
    .from("companies")
    .select("id")
    .eq("normalized_name", normalized)
    .neq("id", companyId)
    .maybeSingle();

  if (conflict) return { error: "name_conflict" };

  const { data, error } = await supabase
    .from("companies")
    .update({ name: newName.trim(), normalized_name: normalized })
    .eq("id", companyId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Company;
}

export type CompanyUpdate = Partial<{
  industry_tags: string[];
  hq_city: string | null;
  hq_lat: number | null;
  hq_lng: number | null;
}>;

export async function updateCompany(
  supabase: SupabaseClient,
  companyId: string,
  patch: CompanyUpdate
): Promise<Company> {
  const { data, error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", companyId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Company;
}

export async function getById(
  supabase: SupabaseClient,
  companyId: string
): Promise<Company | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data as Company | null;
}
