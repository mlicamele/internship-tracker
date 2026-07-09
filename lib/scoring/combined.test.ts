import { describe, it, expect } from "vitest";
import {
  DEFAULT_COMBINED_WEIGHTS,
  computeCombinedScore,
  weightsFromProfile,
} from "./combined";
import type { Profile } from "@/lib/db/types";

// Only the two slider fields matter for these functions.
type WP = Pick<Profile, "combined_weight_fit" | "combined_weight_resume">;

const wp = (fit: number | null, resume: number | null): WP =>
  ({
    combined_weight_fit: fit,
    combined_weight_resume: resume,
  }) as WP;

describe("weightsFromProfile", () => {
  it("falls back to 50/50 when profile is null", () => {
    expect(weightsFromProfile(null)).toEqual({ fit: 0.5, resume: 0.5 });
  });

  it("falls back to 50/50 when either slider is missing/non-numeric", () => {
    expect(weightsFromProfile(wp(null, 50))).toEqual({ fit: 0.5, resume: 0.5 });
    expect(weightsFromProfile(wp(50, null))).toEqual({ fit: 0.5, resume: 0.5 });
    expect(weightsFromProfile(wp(null, null))).toEqual({
      fit: 0.5,
      resume: 0.5,
    });
  });

  it("falls back to 50/50 when both sliders are zero (guards divide-by-zero)", () => {
    expect(weightsFromProfile(wp(0, 0))).toEqual({ fit: 0.5, resume: 0.5 });
  });

  it("falls back to 50/50 when either slider is NaN", () => {
    expect(weightsFromProfile(wp(NaN, 50))).toEqual({ fit: 0.5, resume: 0.5 });
    expect(weightsFromProfile(wp(50, NaN))).toEqual({ fit: 0.5, resume: 0.5 });
  });

  it("returns 0.5/0.5 for balanced 50/50 sliders", () => {
    const w = weightsFromProfile(wp(50, 50));
    expect(w.fit).toBeCloseTo(0.5, 5);
    expect(w.resume).toBeCloseTo(0.5, 5);
  });

  it("normalizes a 75/25 skew to 0.75/0.25 ratio", () => {
    const w = weightsFromProfile(wp(75, 25));
    expect(w.fit).toBeCloseTo(0.75, 5);
    expect(w.resume).toBeCloseTo(0.25, 5);
  });

  it("normalizes non-100 slider sums to a ratio (100/100 → 50/50)", () => {
    // Raw 100/100 must not become 1.0/1.0 — that would double-weight everything.
    const w = weightsFromProfile(wp(100, 100));
    expect(w.fit).toBeCloseTo(0.5, 5);
    expect(w.resume).toBeCloseTo(0.5, 5);
  });

  it("handles full-skew 100/0 and 0/100 (opt-out one axis)", () => {
    expect(weightsFromProfile(wp(100, 0))).toEqual({ fit: 1, resume: 0 });
    expect(weightsFromProfile(wp(0, 100))).toEqual({ fit: 0, resume: 1 });
  });

  it("always returns weights that sum to 1.0", () => {
    for (const p of [
      wp(50, 50),
      wp(75, 25),
      wp(1, 99),
      wp(100, 100),
      wp(30, 70),
      wp(0, 100),
    ]) {
      const w = weightsFromProfile(p);
      expect(w.fit + w.resume).toBeCloseTo(1, 5);
    }
  });
});

describe("DEFAULT_COMBINED_WEIGHTS", () => {
  it("is 50/50 (used as the DB column default)", () => {
    expect(DEFAULT_COMBINED_WEIGHTS.fit).toBe(50);
    expect(DEFAULT_COMBINED_WEIGHTS.resume).toBe(50);
  });
});

describe("computeCombinedScore — degenerate inputs", () => {
  it("returns total=null when BOTH inputs are null", () => {
    const s = computeCombinedScore(null, null, null);
    expect(s.total).toBeNull();
    expect(s.usedResumeSignal).toBe(false);
    // weights must still be populated even in the null-null case — the
    // UI reads them for tooltip display regardless of total.
    expect(s.weights).toEqual({ fit: 0.5, resume: 0.5 });
  });

  it("returns fit alone (percentage) when resume is null, and flags usedResumeSignal=false", () => {
    const s = computeCombinedScore(0.85, null, null);
    expect(s.total).toBe(85);
    expect(s.usedResumeSignal).toBe(false);
  });

  it("does NOT scale the fit-only fallback by the weight slider", () => {
    // Even with a resume-heavy slider, if resume is null we return fit*100
    // straight — the fallback is a "we don't have both signals" path, not
    // a weighted mix with an implicit zero.
    const heavyResume = wp(10, 90);
    const s = computeCombinedScore(0.85, null, heavyResume);
    expect(s.total).toBe(85);
    expect(s.usedResumeSignal).toBe(false);
  });

  it("returns resume alone when fit is null, and flags usedResumeSignal=true", () => {
    const s = computeCombinedScore(null, 72, null);
    expect(s.total).toBe(72);
    expect(s.usedResumeSignal).toBe(true);
  });
});

describe("computeCombinedScore — weighted mix", () => {
  it("mixes fit and resume at default 50/50 when profile is null", () => {
    // fit=0.80 → 80 pct. resume=60. 0.5*80 + 0.5*60 = 70.
    const s = computeCombinedScore(0.8, 60, null);
    expect(s.total).toBe(70);
    expect(s.usedResumeSignal).toBe(true);
    expect(s.weights).toEqual({ fit: 0.5, resume: 0.5 });
  });

  it("shifts the total toward whichever axis the slider weights heavier", () => {
    // fit=0.80 → 80, resume=60. fit-heavy weights should give a higher total.
    const fitHeavy = computeCombinedScore(0.8, 60, wp(75, 25));
    const resumeHeavy = computeCombinedScore(0.8, 60, wp(25, 75));
    expect(fitHeavy.total).toBe(75); // 0.75*80 + 0.25*60
    expect(resumeHeavy.total).toBe(65); // 0.25*80 + 0.75*60
    expect(fitHeavy.total!).toBeGreaterThan(resumeHeavy.total!);
  });

  it("normalizes non-100 slider sums correctly when composing", () => {
    // (30, 30) sliders → 50/50 ratio → same result as (50, 50).
    const s = computeCombinedScore(0.8, 60, wp(30, 30));
    expect(s.total).toBe(70);
  });

  it("rounds the composed total to 2 decimals", () => {
    // fit=0.833 (nonrepeating tail after *100), resume=61.5, 50/50.
    // 0.5*83.3 + 0.5*61.5 = 41.65 + 30.75 = 72.40 → round to 72.4.
    const s = computeCombinedScore(0.833, 61.5, null);
    expect(s.total).toBe(72.4);
    // No floating-point tail past 2dp.
    const total = s.total!;
    expect(Number(total.toFixed(2))).toBe(total);
  });

  it("echoes the normalized weights on the result (for UI tooltip use)", () => {
    const s = computeCombinedScore(0.8, 60, wp(75, 25));
    expect(s.weights.fit).toBeCloseTo(0.75, 5);
    expect(s.weights.resume).toBeCloseTo(0.25, 5);
  });

  it("clamps a fit-only total above 100 down to 100", () => {
    // Defensive: fit is 0..1 by contract, but clamp exists — verify it works.
    const s = computeCombinedScore(1.5, null, null);
    expect(s.total).toBe(100);
  });

  it("clamps a resume-only total above 100 down to 100", () => {
    const s = computeCombinedScore(null, 120, null);
    expect(s.total).toBe(100);
  });

  it("clamps a negative total up to 0", () => {
    const s = computeCombinedScore(-0.5, null, null);
    expect(s.total).toBe(0);
  });

  it("returns 100 when both axes are perfect", () => {
    const s = computeCombinedScore(1, 100, null);
    expect(s.total).toBe(100);
  });

  it("returns 0 when both axes are zero", () => {
    const s = computeCombinedScore(0, 0, null);
    expect(s.total).toBe(0);
  });

  it("keeps usedResumeSignal=true only when the resume input contributed", () => {
    expect(computeCombinedScore(0.5, 50, null).usedResumeSignal).toBe(true);
    expect(computeCombinedScore(0.5, null, null).usedResumeSignal).toBe(false);
    expect(computeCombinedScore(null, 50, null).usedResumeSignal).toBe(true);
    expect(computeCombinedScore(null, null, null).usedResumeSignal).toBe(false);
  });
});
