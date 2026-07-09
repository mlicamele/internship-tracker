import { describe, it, expect } from "vitest";
import {
  RESUME_FIT_WEIGHTS,
  composeNumeric,
  computeInputHash,
  tierFromTotal,
} from "./resume-fit";
import type { ResumeFitDetails, RubricGrade } from "@/lib/db/types";

// Minimum-viable rubric details for composeNumeric. Individual tests spread
// over this and override only the grade(s) they care about, keeping the
// intent visible without a wall of noise. Only the six grade fields are
// overridable — the rest are display-only strings composeNumeric ignores.
type GradeOverrides = Partial<{
  skills_coverage: RubricGrade;
  domain_depth: RubricGrade;
  seniority_fit: RubricGrade;
  impact_evidence: RubricGrade;
  recency_trajectory: RubricGrade;
  practical_exposure: RubricGrade;
}>;

function detailsWithGrades(
  overrides: GradeOverrides = {}
): Omit<ResumeFitDetails, "tier"> {
  return {
    skills_coverage: 5,
    domain_depth: 5,
    seniority_fit: 5,
    impact_evidence: 5,
    recency_trajectory: 5,
    practical_exposure: 5,
    skills_coverage_note: "",
    domain_depth_note: "",
    seniority_fit_note: "",
    impact_evidence_note: "",
    recency_trajectory_note: "",
    practical_exposure_note: "",
    matched_skills: [],
    gaps: [],
    rationale: "",
    resume_version_id_used: "test-resume",
    ...overrides,
  };
}

describe("RESUME_FIT_WEIGHTS", () => {
  it("sums to 14 (guards against future rebalancing bugs)", () => {
    const sum = Object.values(RESUME_FIT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(14);
  });

  it("has a positive weight for every rubric category", () => {
    for (const [cat, w] of Object.entries(RESUME_FIT_WEIGHTS)) {
      expect(w, `${cat} weight`).toBeGreaterThan(0);
    }
  });

  it("keeps 3:2 weight ratio between core (skills/domain) and secondary categories", () => {
    // Coprime pair 2 & 3 is what makes every integer 20-100 reachable.
    expect(RESUME_FIT_WEIGHTS.skills_coverage).toBe(3);
    expect(RESUME_FIT_WEIGHTS.domain_depth).toBe(3);
    expect(RESUME_FIT_WEIGHTS.seniority_fit).toBe(2);
    expect(RESUME_FIT_WEIGHTS.impact_evidence).toBe(2);
    expect(RESUME_FIT_WEIGHTS.recency_trajectory).toBe(2);
    expect(RESUME_FIT_WEIGHTS.practical_exposure).toBe(2);
  });
});

describe("composeNumeric", () => {
  it("scores 10.00 when every grade is the floor (all 1s)", () => {
    // skills+domain: 10*3 each = 60. seniority=1 → SENIORITY[1]=10, x2 = 20.
    // Other three: 10*2 each = 60. Sum 140 / weight-sum 14 = 10.00.
    const total = composeNumeric(
      detailsWithGrades({
        skills_coverage: 1,
        domain_depth: 1,
        seniority_fit: 1,
        impact_evidence: 1,
        recency_trajectory: 1,
        practical_exposure: 1,
      })
    );
    expect(total).toBe(10);
  });

  it("scores 100.00 when every monotonic category is 10 AND seniority is at its peak (5)", () => {
    const total = composeNumeric(
      detailsWithGrades({
        skills_coverage: 10,
        domain_depth: 10,
        seniority_fit: 5,
        impact_evidence: 10,
        recency_trajectory: 10,
        practical_exposure: 10,
      })
    );
    expect(total).toBe(100);
  });

  it("scores <100 when seniority is 10 (over-qualified, weak signal for internships)", () => {
    // All 10s but seniority=10 → SENIORITY[10]=15 instead of 100.
    // (100*3+100*3+15*2+100*2+100*2+100*2)/14 = 1230/14 = 87.857 → 87.86.
    const total = composeNumeric(
      detailsWithGrades({
        skills_coverage: 10,
        domain_depth: 10,
        seniority_fit: 10,
        impact_evidence: 10,
        recency_trajectory: 10,
        practical_exposure: 10,
      })
    );
    expect(total).toBe(87.86);
  });

  it("treats seniority=5 and seniority=6 as equal (the peak plateau)", () => {
    const at5 = composeNumeric(detailsWithGrades({ seniority_fit: 5 }));
    const at6 = composeNumeric(detailsWithGrades({ seniority_fit: 6 }));
    expect(at5).toBe(at6);
  });

  it("scores seniority=5 strictly higher than seniority=10 with all else equal", () => {
    // The whole point of the non-monotonic seniority mapping.
    const atPeak = composeNumeric(detailsWithGrades({ seniority_fit: 5 }));
    const overQual = composeNumeric(detailsWithGrades({ seniority_fit: 10 }));
    expect(atPeak).toBeGreaterThan(overQual);
  });

  it("scores seniority=5 higher than seniority=1 (peak beats under-qualified)", () => {
    const atPeak = composeNumeric(detailsWithGrades({ seniority_fit: 5 }));
    const underQual = composeNumeric(detailsWithGrades({ seniority_fit: 1 }));
    expect(atPeak).toBeGreaterThan(underQual);
  });

  it("weighs skills_coverage (w=3) more than impact_evidence (w=2)", () => {
    // Moving one category 5→10 in isolation. The w=3 category must move
    // the total more than the w=2 category (regression guard against
    // accidentally equalizing the weights).
    const base = composeNumeric(detailsWithGrades());
    const bumpSkills = composeNumeric(
      detailsWithGrades({ skills_coverage: 10 })
    );
    const bumpImpact = composeNumeric(
      detailsWithGrades({ impact_evidence: 10 })
    );
    expect(bumpSkills - base).toBeGreaterThan(bumpImpact - base);
  });

  it("rounds to 2 decimals for stable DB storage", () => {
    // 800/14 = 57.142857... → must round to 57.14, not 57.1428 or 57.14285714.
    const total = composeNumeric(detailsWithGrades());
    expect(total).toBe(57.14);
    // Ensure no floating-point tail past 2dp.
    expect(Number(total.toFixed(2))).toBe(total);
  });

  it("stays within [0, 100] across every valid grade combination boundary", () => {
    const min = composeNumeric(
      detailsWithGrades({
        skills_coverage: 1,
        domain_depth: 1,
        seniority_fit: 1,
        impact_evidence: 1,
        recency_trajectory: 1,
        practical_exposure: 1,
      })
    );
    const max = composeNumeric(
      detailsWithGrades({
        skills_coverage: 10,
        domain_depth: 10,
        seniority_fit: 5,
        impact_evidence: 10,
        recency_trajectory: 10,
        practical_exposure: 10,
      })
    );
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(100);
  });
});

describe("tierFromTotal", () => {
  it("classifies 75 as strong (inclusive lower bound)", () => {
    expect(tierFromTotal(75)).toBe("strong");
  });

  it("classifies 74.99 as partial (just below the strong threshold)", () => {
    expect(tierFromTotal(74.99)).toBe("partial");
  });

  it("classifies 50 as partial (inclusive lower bound)", () => {
    expect(tierFromTotal(50)).toBe("partial");
  });

  it("classifies 49.99 as weak (just below the partial threshold)", () => {
    expect(tierFromTotal(49.99)).toBe("weak");
  });

  it("classifies 100 as strong", () => {
    expect(tierFromTotal(100)).toBe("strong");
  });

  it("classifies 0 as weak", () => {
    expect(tierFromTotal(0)).toBe("weak");
  });
});

// ---------------------------------------------------------------
// computeInputHash — the highest-stakes cache-correctness function.
// A false MISS costs a Groq call. A false HIT returns a stale
// score. Either way the user sees the wrong number.
// ---------------------------------------------------------------

const baseRole = {
  title: "Software Engineer Intern",
  tags: ["SWE", "React"],
  jd_body_text: "Build web apps at scale.",
};

describe("computeInputHash — determinism", () => {
  it("returns the same 64-char hex hash for identical inputs", () => {
    const h1 = computeInputHash(baseRole, "resume-1");
    const h2 = computeInputHash(baseRole, "resume-1");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for different resume versions", () => {
    const a = computeInputHash(baseRole, "resume-1");
    const b = computeInputHash(baseRole, "resume-2");
    expect(a).not.toBe(b);
  });
});

describe("computeInputHash — normalization (false-miss guards)", () => {
  // Every input goes through normalization before hashing. A cosmetic
  // change to any of these must NOT invalidate the cache — otherwise
  // trivial edits burn Groq calls and refuse to serve cached scores.

  it("ignores tag order (tags are sorted before hashing)", () => {
    const a = computeInputHash(
      { ...baseRole, tags: ["React", "SWE"] },
      "resume-1"
    );
    const b = computeInputHash(
      { ...baseRole, tags: ["SWE", "React"] },
      "resume-1"
    );
    expect(a).toBe(b);
  });

  it("ignores tag casing (tags are lowercased)", () => {
    const a = computeInputHash({ ...baseRole, tags: ["SWE"] }, "resume-1");
    const b = computeInputHash({ ...baseRole, tags: ["swe"] }, "resume-1");
    expect(a).toBe(b);
  });

  it("ignores surrounding whitespace on tags", () => {
    const a = computeInputHash({ ...baseRole, tags: ["SWE"] }, "resume-1");
    const b = computeInputHash({ ...baseRole, tags: ["  SWE  "] }, "resume-1");
    expect(a).toBe(b);
  });

  it("ignores whitespace variance in jd_body_text (collapsed to single spaces)", () => {
    const a = computeInputHash(
      { ...baseRole, jd_body_text: "Build web apps at scale." },
      "resume-1"
    );
    const b = computeInputHash(
      { ...baseRole, jd_body_text: "Build   web\napps\tat\n\nscale." },
      "resume-1"
    );
    expect(a).toBe(b);
  });

  it("ignores leading/trailing whitespace in jd_body_text", () => {
    const a = computeInputHash(
      { ...baseRole, jd_body_text: "Build web apps at scale." },
      "resume-1"
    );
    const b = computeInputHash(
      { ...baseRole, jd_body_text: "\n  Build web apps at scale.  \n" },
      "resume-1"
    );
    expect(a).toBe(b);
  });

  it("ignores title casing", () => {
    const a = computeInputHash(
      { ...baseRole, title: "Software Engineer Intern" },
      "resume-1"
    );
    const b = computeInputHash(
      { ...baseRole, title: "SOFTWARE ENGINEER INTERN" },
      "resume-1"
    );
    expect(a).toBe(b);
  });

  it("ignores title surrounding whitespace", () => {
    const a = computeInputHash(
      { ...baseRole, title: "Software Engineer Intern" },
      "resume-1"
    );
    const b = computeInputHash(
      { ...baseRole, title: "  Software Engineer Intern  " },
      "resume-1"
    );
    expect(a).toBe(b);
  });

  it("treats null jd_body_text and '' as equivalent", () => {
    const a = computeInputHash(
      { ...baseRole, jd_body_text: null },
      "resume-1"
    );
    const b = computeInputHash({ ...baseRole, jd_body_text: "" }, "resume-1");
    expect(a).toBe(b);
  });
});

describe("computeInputHash — sensitivity (false-hit guards)", () => {
  // The other side of the coin: real content changes MUST invalidate.
  // If any of these produce the same hash, the score goes stale silently.

  it("changes when a tag is added", () => {
    const a = computeInputHash({ ...baseRole, tags: ["SWE"] }, "resume-1");
    const b = computeInputHash(
      { ...baseRole, tags: ["SWE", "React"] },
      "resume-1"
    );
    expect(a).not.toBe(b);
  });

  it("changes when title content changes", () => {
    const a = computeInputHash(
      { ...baseRole, title: "Software Engineer Intern" },
      "resume-1"
    );
    const b = computeInputHash(
      { ...baseRole, title: "Data Science Intern" },
      "resume-1"
    );
    expect(a).not.toBe(b);
  });

  it("changes when jd_body_text content changes", () => {
    const a = computeInputHash(
      { ...baseRole, jd_body_text: "Build web apps." },
      "resume-1"
    );
    const b = computeInputHash(
      { ...baseRole, jd_body_text: "Train ML models." },
      "resume-1"
    );
    expect(a).not.toBe(b);
  });
});
