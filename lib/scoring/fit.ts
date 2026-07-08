// Fit score = weighted sum of three independent components:
//   0.5 × class-year eligibility
// + 0.3 × distance fit
// + 0.2 × interest overlap
//
// All components clamp to [0, 1]. When a signal is missing (e.g. no profile
// grad_year, no home coords, no interest tags on either side), we return 0.5
// for that component — neutral, no push either direction. That way a fresh
// profile with everything empty scores 0.5 across the board, and rows can
// only be *pushed away from* that midpoint by actual evidence.
//
// Function is pure — no DB, no side effects. Call from role-create paths and
// batch-recompute after profile edits. Unit tests live in fit.test.ts.
//
// RELATED (deferred, likely Phase 3B): a distinct "resume fit" metric — how
// well the user's resume matches the role's stated requirements. That's a
// SEPARATE axis from this score: fit = how much the user wants the role,
// resume-fit = how much the role wants the user. Both surface side-by-side
// in the UI, not combined into a single weighted total. Depends on the
// resume upload / pdf-parse work (Phase 6-A).

import { weightedNearestDistance } from "@/lib/distance";
import type { Profile, Role } from "@/lib/db/types";

/**
 * Default weights when the profile hasn't set custom ones (or when the
 * pure function is called without a profile in tests). Migration 0014
 * mirrors these in the DB defaults (50/30/20 slider positions).
 */
export const FIT_WEIGHTS = {
  classYear: 0.5,
  distance: 0.3,
  interest: 0.2,
} as const;

/**
 * Preset weight tuples surfaced in the settings picker. Named to match the
 * UX labels ("Balanced" / "Location-focused" / "Eligibility-strict"). Each
 * expresses the intent as raw slider positions (0-100); ratios are what
 * matter downstream after normalization.
 */
export const FIT_WEIGHT_PRESETS = {
  balanced: { classYear: 50, distance: 30, interest: 20 },
  location: { classYear: 30, distance: 50, interest: 20 },
  eligibility: { classYear: 70, distance: 20, interest: 10 },
} as const satisfies Record<
  string,
  { classYear: number; distance: number; interest: number }
>;
export type FitWeightPresetName = keyof typeof FIT_WEIGHT_PRESETS;

export interface FitComponents {
  classYear: number;
  distance: number;
  interest: number;
}

export interface FitWeights {
  classYear: number;
  distance: number;
  interest: number;
}

export interface FitScore {
  /** Weighted total in [0, 1], rounded to 2 decimals for DB (NUMERIC(5,2)). */
  total: number;
  components: FitComponents;
  /** Normalized ratios (sum to 1.0) — either from profile or FIT_WEIGHTS default. */
  weights: FitWeights;
  /** Actual nearest distance in miles used for the distance component. Null when unknown. */
  distanceMiles: number | null;
  /** True only when we *actively* determined the user's grad year falls outside the role's bounds. Null profile grad_year → false. */
  ineligible: boolean;
}

const NEUTRAL = 0.5;

/** Multiplier on `profile.local_radius_miles` at which the linear distance decay reaches zero, per relocation_tolerance. */
const DISTANCE_DECAY_K = {
  nope: 2,
  regional: 6,
  anywhere: 20,
} as const;

/** Distance-component fallback when the role has no geocoded locations. */
const REMOTE_UNGEOCODED_SCORE = 0.8;
const UNKNOWN_UNGEOCODED_SCORE = 0.4;

type ScoreProfile = Pick<
  Profile,
  | "grad_year"
  | "home_lat"
  | "home_lng"
  | "local_radius_miles"
  | "relocation_tolerance"
  | "interest_tags"
> &
  // Weights are optional at the type level so tests can pass a minimal
  // profile fixture; runtime code paths will always populate them via the
  // migration 0014 default.
  Partial<
    Pick<
      Profile,
      "fit_weight_class_year" | "fit_weight_distance" | "fit_weight_interest"
    >
  >;

type ScoreRole = Pick<
  Role,
  "min_grad_year" | "max_grad_year" | "locations" | "work_model" | "tags"
>;

export function computeFitScore(
  role: ScoreRole,
  profile: ScoreProfile
): FitScore {
  const classYear = scoreClassYear(role, profile);
  const { distance, distanceMiles } = scoreDistance(role, profile);
  const interest = scoreInterest(role, profile);

  const weights = weightsFromProfile(profile);

  const total = round2(
    classYear * weights.classYear +
      distance * weights.distance +
      interest * weights.interest
  );

  // Ineligible is a distinct concept from "class-year component = 0". Only
  // true when we *know* the grad_year and it fails the role's bounds. A
  // null grad_year returns 0.5 for the component and ineligible=false.
  const ineligible = profile.grad_year != null && classYear === 0;

  return {
    total,
    components: { classYear, distance, interest },
    weights,
    distanceMiles,
    ineligible,
  };
}

function scoreClassYear(role: ScoreRole, profile: ScoreProfile): number {
  if (profile.grad_year == null) return NEUTRAL;
  const min = role.min_grad_year ?? -Infinity;
  const max = role.max_grad_year ?? Infinity;
  return profile.grad_year >= min && profile.grad_year <= max ? 1 : 0;
}

function scoreDistance(
  role: ScoreRole,
  profile: ScoreProfile
): { distance: number; distanceMiles: number | null } {
  if (profile.home_lat == null || profile.home_lng == null) {
    return { distance: NEUTRAL, distanceMiles: null };
  }

  const d = weightedNearestDistance(role.locations, [
    { lat: profile.home_lat, lng: profile.home_lng, weight: 1 },
  ]);

  if (d == null) {
    if (role.work_model === "remote") {
      return { distance: REMOTE_UNGEOCODED_SCORE, distanceMiles: null };
    }
    return { distance: UNKNOWN_UNGEOCODED_SCORE, distanceMiles: null };
  }

  // Guard divide-by-zero on radius; treat 0 as 1 so decay is well-defined.
  const radius = Math.max(profile.local_radius_miles, 1);
  const k = DISTANCE_DECAY_K[profile.relocation_tolerance];
  const decayed = Math.max(0, 1 - d / (k * radius));

  return { distance: decayed, distanceMiles: d };
}

function scoreInterest(role: ScoreRole, profile: ScoreProfile): number {
  if (profile.interest_tags.length === 0 || role.tags.length === 0) {
    return NEUTRAL;
  }
  const roleSet = new Set(role.tags);
  let overlap = 0;
  for (const t of profile.interest_tags) if (roleSet.has(t)) overlap++;
  return overlap / Math.min(profile.interest_tags.length, role.tags.length);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Read the profile's per-component fit weights (raw 0-100 sliders) and
 * normalize into ratios summing to 1.0. Fall back to FIT_WEIGHTS when
 * a profile column is missing (test fixtures, pre-migration rows).
 * If every weight is somehow zero, fall back to defaults instead of
 * dividing by zero.
 */
function weightsFromProfile(profile: ScoreProfile): {
  classYear: number;
  distance: number;
  interest: number;
} {
  const cy = profile.fit_weight_class_year;
  const d = profile.fit_weight_distance;
  const i = profile.fit_weight_interest;
  if (cy == null || d == null || i == null) return { ...FIT_WEIGHTS };
  const sum = cy + d + i;
  if (sum <= 0) return { ...FIT_WEIGHTS };
  return {
    classYear: cy / sum,
    distance: d / sum,
    interest: i / sum,
  };
}

/** UI band for coloring a fit score. Thresholds: 0.75+ high, 0.5+ mid, else low. */
export type FitBand = "high" | "mid" | "low";

export function fitBand(total: number): FitBand {
  if (total >= 0.75) return "high";
  if (total >= 0.5) return "mid";
  return "low";
}
