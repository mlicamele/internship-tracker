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
import type { Profile, RelocationTolerance, Role } from "@/lib/db/types";

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

/**
 * Four fixed distance tiers matched by nearest geocoded location.
 * Thresholds are fixed (not user-configurable) — they correspond to
 * widely-shared intuitions about US travel:
 *   Commutable (0-30 mi)   → daily commute realistic
 *   Regional   (30-150 mi) → day-trip / weekend commute possible
 *   Domestic   (150-1000)  → flight required, still domestic
 *   Distant    (1000+ mi)  → international / coast-to-coast
 * See spec: docs/superpowers/specs/2026-08-12-distance-scoring-tiers-design.md
 */
export type DistanceTier = "commutable" | "regional" | "domestic" | "distant";

export const DISTANCE_TIER_ORDER: readonly DistanceTier[] = [
  "commutable",
  "regional",
  "domestic",
  "distant",
] as const;

/** Upper bound (exclusive above) in miles for each tier. */
const DISTANCE_TIER_THRESHOLDS: Record<
  Exclude<DistanceTier, "distant">,
  number
> = {
  commutable: 30,
  regional: 150,
  domestic: 1000,
};

/**
 * Preset tier-score profiles keyed by `relocation_tolerance`. Reused
 * existing field so no schema addition was needed for the preset itself.
 * All floors ≥ 0.20 — distance is a soft signal, not a disqualifier.
 */
const PRESET_TIER_SCORES: Record<
  RelocationTolerance,
  Record<DistanceTier, number>
> = {
  nope: { commutable: 1.0, regional: 0.55, domestic: 0.3, distant: 0.2 },
  regional: { commutable: 1.0, regional: 0.85, domestic: 0.65, distant: 0.5 },
  anywhere: { commutable: 1.0, regional: 0.95, domestic: 0.9, distant: 0.85 },
};

/** Which tier a distance belongs to. Lower bound of each tier is inclusive. */
export function tierForDistance(miles: number): DistanceTier {
  if (miles <= DISTANCE_TIER_THRESHOLDS.commutable) return "commutable";
  if (miles <= DISTANCE_TIER_THRESHOLDS.regional) return "regional";
  if (miles <= DISTANCE_TIER_THRESHOLDS.domestic) return "domestic";
  return "distant";
}

/** Score for a tier, respecting per-tier overrides on the profile before falling back to the preset. */
function tierScoreFor(profile: ScoreProfile, tier: DistanceTier): number {
  const override =
    tier === "commutable"
      ? profile.fit_dist_tier_score_commutable
      : tier === "regional"
        ? profile.fit_dist_tier_score_regional
        : tier === "domestic"
          ? profile.fit_dist_tier_score_domestic
          : profile.fit_dist_tier_score_distant;
  if (override != null && Number.isFinite(override)) return override;
  return PRESET_TIER_SCORES[profile.relocation_tolerance][tier];
}

type ScoreProfile = Pick<
  Profile,
  | "grad_year"
  | "home_lat"
  | "home_lng"
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
  > &
  // Per-tier overrides — always present after migration 0019 (nullable
  // columns default to null, meaning "use preset").
  Partial<
    Pick<
      Profile,
      | "fit_dist_tier_score_commutable"
      | "fit_dist_tier_score_regional"
      | "fit_dist_tier_score_domestic"
      | "fit_dist_tier_score_distant"
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
  // No home reference — can't compute distance, don't push either way.
  if (profile.home_lat == null || profile.home_lng == null) {
    return { distance: NEUTRAL, distanceMiles: null };
  }

  // Remote roles have zero commute by definition — always Commutable-tier
  // regardless of geocode. Uses the profile's Commutable tier score so
  // "anywhere"-preset users still get 1.0 and "nope"-preset users also
  // get 1.0 (Commutable is 1.0 in every preset). Overrides still apply.
  if (role.work_model === "remote") {
    return {
      distance: tierScoreFor(profile, "commutable"),
      distanceMiles: null,
    };
  }

  const d = weightedNearestDistance(role.locations, [
    { lat: profile.home_lat, lng: profile.home_lng, weight: 1 },
  ]);

  // Non-remote with no geocoded location — we honestly don't know how far
  // it is, so return neutral. Previous 0.4-for-unknown / 0.8-for-remote
  // fallbacks were arbitrary; NEUTRAL matches how other missing signals
  // are handled (scoreClassYear on null grad_year, scoreInterest on empty
  // tags on either side).
  if (d == null) return { distance: NEUTRAL, distanceMiles: null };

  const tier = tierForDistance(d);
  return { distance: tierScoreFor(profile, tier), distanceMiles: d };
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
