// Combined-score composition. Read-time only — no DB column, no rescore
// when the user moves a slider. Callers pass in the two axis scores and
// the raw slider positions from the profile.
//
//   fit         : lib/scoring/fit.ts (weighted classYear+distance+interest, 0..1)
//   resume_fit  : lib/scoring/resume-fit.ts (composed from LLM tiers, 0..100)
//   combined    = w_fit_normalized × fit_pct + w_resume_normalized × resume_fit
//
// When resume_fit is null (never scored / insufficient signal / no resume),
// combined falls back to fit alone with `usedResumeSignal=false` so the UI
// can flag it as a partial signal.

import type { Profile } from "@/lib/db/types";

export const DEFAULT_COMBINED_WEIGHTS = {
  fit: 50,
  resume: 50,
} as const;

export interface CombinedWeights {
  /** Raw 0..100 slider position for the fit axis. */
  fit: number;
  /** Raw 0..100 slider position for the resume-fit axis. */
  resume: number;
}

export interface CombinedScore {
  /** Composed 0-100, rounded to 2 decimals. Null iff BOTH inputs were null. */
  total: number | null;
  /** True when the resume axis contributed; false when combined = fit alone. */
  usedResumeSignal: boolean;
  /** Normalized weights actually applied (sum to 1.0). */
  weights: { fit: number; resume: number };
}

type WeightsProfile = Pick<
  Profile,
  "combined_weight_fit" | "combined_weight_resume"
>;

/**
 * Read the profile's raw sliders (0..100 each) and normalize to a
 * ratio summing to 1.0. Missing / non-numeric / zero-sum → default 50/50.
 */
export function weightsFromProfile(profile: WeightsProfile | null): {
  fit: number;
  resume: number;
} {
  const rawFit = profile?.combined_weight_fit;
  const rawRes = profile?.combined_weight_resume;
  if (
    typeof rawFit !== "number" ||
    typeof rawRes !== "number" ||
    !Number.isFinite(rawFit) ||
    !Number.isFinite(rawRes) ||
    rawFit + rawRes <= 0
  ) {
    return { fit: 0.5, resume: 0.5 };
  }
  const sum = rawFit + rawRes;
  return { fit: rawFit / sum, resume: rawRes / sum };
}

/**
 * Compose the combined score.
 *
 * @param fitTotal      Result from computeFitScore(...).total (0..1) or null.
 * @param resumeFitScore Persisted applications.resume_fit_score (0..100) or null.
 * @param profile       Read for the raw combined_weight_* sliders. Null → default 50/50.
 * @returns             CombinedScore. `total=null` only if BOTH inputs are null.
 */
export function computeCombinedScore(
  fitTotal: number | null,
  resumeFitScore: number | null,
  profile: WeightsProfile | null
): CombinedScore {
  const weights = weightsFromProfile(profile);

  const fitPct = fitTotal == null ? null : fitTotal * 100;

  if (fitPct == null && resumeFitScore == null) {
    return { total: null, usedResumeSignal: false, weights };
  }

  if (resumeFitScore == null) {
    return {
      total: round2(clamp(fitPct as number, 0, 100)),
      usedResumeSignal: false,
      weights,
    };
  }

  if (fitPct == null) {
    return {
      total: round2(clamp(resumeFitScore, 0, 100)),
      usedResumeSignal: true,
      weights,
    };
  }

  const total =
    weights.fit * fitPct + weights.resume * resumeFitScore;
  return {
    total: round2(clamp(total, 0, 100)),
    usedResumeSignal: true,
    weights,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
