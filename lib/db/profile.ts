// Profile data-access. Each function takes a Supabase client so callers can
// use either the cookie-bound server client (server actions / RSC) or the
// service-role client (Phase 5 scraper fan-out).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, RelocationTolerance } from "./types";

export interface ProfileUpdate {
  school?: string;
  grad_year?: number;
  home_address?: string;
  home_lat?: number | null;
  home_lng?: number | null;
  local_radius_miles?: number;
  relocation_tolerance?: RelocationTolerance;
  interest_tags?: string[];
  fit_weight_class_year?: number;
  fit_weight_distance?: number;
  fit_weight_interest?: number;
  fit_dist_tier_score_commutable?: number | null;
  fit_dist_tier_score_regional?: number | null;
  fit_dist_tier_score_domestic?: number | null;
  fit_dist_tier_score_distant?: number | null;
}

export async function getProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  patch: ProfileUpdate
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data as Profile;
}

export async function completeOnboarding(
  supabase: SupabaseClient,
  userId: string
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data as Profile;
}

/**
 * Which onboarding step does the user need next? Used by /onboard to
 * server-render the correct step, and by the middleware to gate-keep.
 */
export type OnboardingStep = "basics" | "location" | "interests" | "finish" | "done";

export function nextOnboardingStep(profile: Profile): OnboardingStep {
  if (profile.onboarding_completed_at) return "done";
  if (!profile.school || !profile.grad_year) return "basics";
  if (!profile.home_address) return "location";
  if (!profile.interest_tags || profile.interest_tags.length === 0) return "interests";
  return "finish";
}
