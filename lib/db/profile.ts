// Profile data-access stubs. Implementations land during Phase 1 Track 1-C
// (onboarding wizard) — these signatures exist so 1-B and 1-C can compile
// against them in parallel.

import type { Profile } from "./types";

const NOT_IMPLEMENTED = "Not implemented yet — see Phase 1 Track 1-C in the build plan.";

export async function getProfile(_userId: string): Promise<Profile | null> {
  throw new Error(NOT_IMPLEMENTED);
}

export interface ProfileUpdate {
  school?: string;
  grad_year?: number;
  home_address?: string;
  home_lat?: number;
  home_lng?: number;
  local_radius_miles?: number;
  relocation_tolerance?: Profile["relocation_tolerance"];
  interest_tags?: string[];
}

export async function updateProfile(
  _userId: string,
  _patch: ProfileUpdate
): Promise<Profile> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function completeOnboarding(_userId: string): Promise<Profile> {
  throw new Error(NOT_IMPLEMENTED);
}
