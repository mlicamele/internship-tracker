import { describe, it, expect } from "vitest";
import { computeFitScore, FIT_WEIGHTS } from "./fit";
import type { Profile, Role } from "@/lib/db/types";

// Minimum-viable profile / role fixtures — each test spreads over these and
// overrides only the fields it cares about. Keeps the intent of each case
// visible without a wall of unrelated field-setting boilerplate.

const baseProfile: Pick<
  Profile,
  | "grad_year"
  | "home_lat"
  | "home_lng"
  | "local_radius_miles"
  | "relocation_tolerance"
  | "interest_tags"
> = {
  grad_year: 2028,
  home_lat: 40.7128,
  home_lng: -74.006,
  local_radius_miles: 100,
  relocation_tolerance: "regional",
  interest_tags: [],
};

const baseRole: Pick<
  Role,
  "min_grad_year" | "max_grad_year" | "locations" | "work_model" | "tags"
> = {
  min_grad_year: null,
  max_grad_year: null,
  locations: [],
  work_model: null,
  tags: [],
};

// Latitude 40.7128 → 100 miles due north lands roughly at lat 42.16
// (100 / 69.0472 ≈ 1.4483° per 100 mi). Use with toBeCloseTo since Earth
// isn't a perfect sphere.
const NYC_LAT = 40.7128;
const NYC_LNG = -74.006;
const ONE_HUNDRED_MI_NORTH = NYC_LAT + 100 / 69.0472; // ≈ 42.16
const FIFTY_MI_NORTH = NYC_LAT + 50 / 69.0472;
const TWO_HUNDRED_MI_NORTH = NYC_LAT + 200 / 69.0472;

describe("computeFitScore — class-year component", () => {
  it("returns 0.5 when profile.grad_year is null (no signal)", () => {
    const s = computeFitScore(baseRole, { ...baseProfile, grad_year: null });
    expect(s.components.classYear).toBe(0.5);
    expect(s.ineligible).toBe(false);
  });

  it("returns 1 when both bounds are null (fully open role)", () => {
    const s = computeFitScore(baseRole, baseProfile);
    expect(s.components.classYear).toBe(1);
    expect(s.ineligible).toBe(false);
  });

  it("scores 1 when grad_year is at the min-only lower bound", () => {
    const role = { ...baseRole, min_grad_year: 2028 };
    expect(computeFitScore(role, baseProfile).components.classYear).toBe(1);
  });

  it("scores 0 when grad_year is below a min-only bound", () => {
    const role = { ...baseRole, min_grad_year: 2029 };
    const s = computeFitScore(role, baseProfile);
    expect(s.components.classYear).toBe(0);
    expect(s.ineligible).toBe(true);
  });

  it("scores 1 when grad_year is at the max-only upper bound", () => {
    const role = { ...baseRole, max_grad_year: 2028 };
    expect(computeFitScore(role, baseProfile).components.classYear).toBe(1);
  });

  it("scores 0 when grad_year is above a max-only bound", () => {
    const role = { ...baseRole, max_grad_year: 2027 };
    const s = computeFitScore(role, baseProfile);
    expect(s.components.classYear).toBe(0);
    expect(s.ineligible).toBe(true);
  });

  it("scores 1 inside a two-sided window (inclusive on both ends)", () => {
    const role = { ...baseRole, min_grad_year: 2027, max_grad_year: 2029 };
    for (const y of [2027, 2028, 2029]) {
      expect(
        computeFitScore(role, { ...baseProfile, grad_year: y }).components
          .classYear
      ).toBe(1);
    }
  });

  it("scores 0 outside a two-sided window", () => {
    const role = { ...baseRole, min_grad_year: 2027, max_grad_year: 2029 };
    for (const y of [2026, 2030]) {
      expect(
        computeFitScore(role, { ...baseProfile, grad_year: y }).components
          .classYear
      ).toBe(0);
    }
  });

  it("handles inverted bounds (min > max, data bug) as ineligible", () => {
    const role = { ...baseRole, min_grad_year: 2029, max_grad_year: 2027 };
    expect(computeFitScore(role, baseProfile).components.classYear).toBe(0);
  });
});

describe("computeFitScore — distance component", () => {
  it("returns 0.5 with distanceMiles=null when profile has no home coords", () => {
    const profile = { ...baseProfile, home_lat: null, home_lng: null };
    const role = {
      ...baseRole,
      locations: [{ text: "SF", lat: 37.77, lng: -122.42 }],
    };
    const s = computeFitScore(role, profile);
    expect(s.components.distance).toBe(0.5);
    expect(s.distanceMiles).toBeNull();
  });

  it("returns 0.8 when the role has no geocoded locations but work_model is remote", () => {
    const role = {
      ...baseRole,
      locations: [{ text: "Remote", lat: null, lng: null }],
      work_model: "remote" as const,
    };
    const s = computeFitScore(role, baseProfile);
    expect(s.components.distance).toBe(0.8);
    expect(s.distanceMiles).toBeNull();
  });

  it("returns 0.4 when the role has no geocoded locations and work_model is not remote", () => {
    for (const work_model of ["onsite", "hybrid", null] as const) {
      const role = {
        ...baseRole,
        locations: [{ text: "?", lat: null, lng: null }],
        work_model,
      };
      const s = computeFitScore(role, baseProfile);
      expect(s.components.distance).toBe(0.4);
      expect(s.distanceMiles).toBeNull();
    }
  });

  it("scores 1.0 when role location equals home (d=0)", () => {
    const role = {
      ...baseRole,
      locations: [{ text: "NYC", lat: NYC_LAT, lng: NYC_LNG }],
    };
    const s = computeFitScore(role, baseProfile);
    expect(s.components.distance).toBe(1);
    expect(s.distanceMiles).toBeCloseTo(0, 5);
  });

  it("regional tolerance decays to ~0.833 at exactly 1×radius", () => {
    const role = {
      ...baseRole,
      locations: [{ text: "far", lat: ONE_HUNDRED_MI_NORTH, lng: NYC_LNG }],
    };
    const s = computeFitScore(role, baseProfile);
    expect(s.distanceMiles).toBeCloseTo(100, 0);
    // 1 - 100/(6*100) = 5/6 ≈ 0.833
    expect(s.components.distance).toBeCloseTo(5 / 6, 2);
  });

  it("nope tolerance decays to ~0.5 at exactly 1×radius", () => {
    const role = {
      ...baseRole,
      locations: [{ text: "far", lat: ONE_HUNDRED_MI_NORTH, lng: NYC_LNG }],
    };
    const s = computeFitScore(role, {
      ...baseProfile,
      relocation_tolerance: "nope",
    });
    expect(s.components.distance).toBeCloseTo(0.5, 2);
  });

  it("nope tolerance is dead at 2×radius", () => {
    const role = {
      ...baseRole,
      locations: [{ text: "far", lat: TWO_HUNDRED_MI_NORTH, lng: NYC_LNG }],
    };
    const s = computeFitScore(role, {
      ...baseProfile,
      relocation_tolerance: "nope",
    });
    expect(s.components.distance).toBeCloseTo(0, 2);
  });

  it("anywhere tolerance still scores ~0.95 at 1×radius", () => {
    const role = {
      ...baseRole,
      locations: [{ text: "far", lat: ONE_HUNDRED_MI_NORTH, lng: NYC_LNG }],
    };
    const s = computeFitScore(role, {
      ...baseProfile,
      relocation_tolerance: "anywhere",
    });
    expect(s.components.distance).toBeCloseTo(0.95, 2);
  });

  it("clamps to 0 when distance far exceeds the tolerance's dead-zone", () => {
    const role = {
      ...baseRole,
      // 100 degrees of latitude ≈ 6900 miles — well past even anywhere's 20×100
      locations: [{ text: "far", lat: NYC_LAT + 100, lng: NYC_LNG }],
    };
    for (const tol of ["nope", "regional", "anywhere"] as const) {
      const s = computeFitScore(role, {
        ...baseProfile,
        relocation_tolerance: tol,
      });
      expect(s.components.distance).toBe(0);
    }
  });

  it("guards against divide-by-zero when local_radius_miles is 0", () => {
    const role = {
      ...baseRole,
      locations: [{ text: "close", lat: FIFTY_MI_NORTH, lng: NYC_LNG }],
    };
    const s = computeFitScore(role, {
      ...baseProfile,
      local_radius_miles: 0,
    });
    // Radius clamped to 1 → distance 50 miles vastly exceeds all tolerance dead-zones
    expect(s.components.distance).toBe(0);
    expect(Number.isFinite(s.components.distance)).toBe(true);
  });

  it("uses the NEAREST of multiple geocoded locations", () => {
    const role = {
      ...baseRole,
      locations: [
        { text: "far", lat: TWO_HUNDRED_MI_NORTH, lng: NYC_LNG },
        { text: "here", lat: NYC_LAT, lng: NYC_LNG },
      ],
    };
    const s = computeFitScore(role, baseProfile);
    expect(s.distanceMiles).toBeCloseTo(0, 5);
    expect(s.components.distance).toBe(1);
  });

  it("ignores locations with null coords when picking nearest", () => {
    const role = {
      ...baseRole,
      locations: [
        { text: "here", lat: NYC_LAT, lng: NYC_LNG },
        { text: "unknown", lat: null, lng: null },
      ],
    };
    const s = computeFitScore(role, baseProfile);
    expect(s.distanceMiles).toBeCloseTo(0, 5);
  });
});

describe("computeFitScore — interest component", () => {
  it("returns 0.5 when profile has no interest_tags", () => {
    const role = { ...baseRole, tags: ["SWE"] };
    expect(computeFitScore(role, baseProfile).components.interest).toBe(0.5);
  });

  it("returns 0.5 when role has no tags", () => {
    const profile = { ...baseProfile, interest_tags: ["SWE"] };
    expect(computeFitScore(baseRole, profile).components.interest).toBe(0.5);
  });

  it("returns 1.0 on exact match", () => {
    const profile = { ...baseProfile, interest_tags: ["SWE"] };
    const role = { ...baseRole, tags: ["SWE"] };
    expect(computeFitScore(role, profile).components.interest).toBe(1);
  });

  it("returns 1.0 when profile is subset of role tags (all interests hit)", () => {
    const profile = { ...baseProfile, interest_tags: ["Quant"] };
    const role = { ...baseRole, tags: ["Quant", "Fintech"] };
    // overlap=1 / min(1, 2) = 1
    expect(computeFitScore(role, profile).components.interest).toBe(1);
  });

  it("returns 1.0 when role tags are subset of profile interests (all role tags matched)", () => {
    const profile = { ...baseProfile, interest_tags: ["SWE", "Quant"] };
    const role = { ...baseRole, tags: ["Quant"] };
    // overlap=1 / min(2, 1) = 1
    expect(computeFitScore(role, profile).components.interest).toBe(1);
  });

  it("returns 0.5 on partial overlap (1 of 2 matched, sets of size 2)", () => {
    const profile = { ...baseProfile, interest_tags: ["SWE", "Quant"] };
    const role = { ...baseRole, tags: ["Quant", "Fintech"] };
    // overlap=1 / min(2, 2) = 0.5
    expect(computeFitScore(role, profile).components.interest).toBe(0.5);
  });

  it("returns 0 when there is no overlap", () => {
    const profile = { ...baseProfile, interest_tags: ["SWE"] };
    const role = { ...baseRole, tags: ["Quant"] };
    expect(computeFitScore(role, profile).components.interest).toBe(0);
  });
});

describe("computeFitScore — weighted total", () => {
  it("weights sum to 1 (guards against future rebalancing bugs)", () => {
    const sum =
      FIT_WEIGHTS.classYear + FIT_WEIGHTS.distance + FIT_WEIGHTS.interest;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("returns 0.5 across the board when every component is neutral", () => {
    // No grad_year (neutral), no home coords (neutral), no tag overlap (neutral)
    const profile = {
      ...baseProfile,
      grad_year: null,
      home_lat: null,
      home_lng: null,
      interest_tags: [],
    };
    const s = computeFitScore(baseRole, profile);
    expect(s.components).toEqual({
      classYear: 0.5,
      distance: 0.5,
      interest: 0.5,
    });
    expect(s.total).toBe(0.5);
    expect(s.ineligible).toBe(false);
  });

  it("returns 1.0 when every component is a full hit", () => {
    const profile = { ...baseProfile, interest_tags: ["SWE"] };
    const role = {
      ...baseRole,
      min_grad_year: 2028,
      max_grad_year: 2028,
      locations: [{ text: "NYC", lat: NYC_LAT, lng: NYC_LNG }],
      tags: ["SWE"],
    };
    const s = computeFitScore(role, profile);
    expect(s.total).toBe(1);
    expect(s.ineligible).toBe(false);
  });

  it("returns 0.0 when class-year fails AND distance is dead AND no interest overlap", () => {
    const profile = {
      ...baseProfile,
      relocation_tolerance: "nope" as const,
      interest_tags: ["Quant"],
    };
    const role = {
      ...baseRole,
      min_grad_year: 2029,
      max_grad_year: 2029,
      locations: [{ text: "far", lat: NYC_LAT + 100, lng: NYC_LNG }],
      tags: ["Robotics"],
    };
    const s = computeFitScore(role, profile);
    expect(s.total).toBe(0);
    expect(s.ineligible).toBe(true);
  });

  it("combines mixed components via the documented weights", () => {
    // Eligible (1.0) + regional at 1×radius (5/6) + full-interest (1.0)
    const profile = { ...baseProfile, interest_tags: ["SWE"] };
    const role = {
      ...baseRole,
      locations: [{ text: "far", lat: ONE_HUNDRED_MI_NORTH, lng: NYC_LNG }],
      tags: ["SWE"],
    };
    const s = computeFitScore(role, profile);
    // 1*0.5 + (5/6)*0.3 + 1*0.2 = 0.5 + 0.25 + 0.2 = 0.95
    expect(s.total).toBeCloseTo(0.95, 2);
  });

  it("rounds the total to 2 decimals for DB storage", () => {
    // Interest overlap: intersect=1, min(3,3)=3 → 1/3 = 0.3333...
    const profile = {
      ...baseProfile,
      interest_tags: ["SWE", "Quant", "ML/AI"],
    };
    const role = {
      ...baseRole,
      locations: [{ text: "at home", lat: NYC_LAT, lng: NYC_LNG }],
      tags: ["SWE", "Robotics", "HCI"],
    };
    const s = computeFitScore(role, profile);
    // total is 1*0.5 + 1*0.3 + (1/3)*0.2 = 0.8666...
    // We round to 2 dp → 0.87
    expect(s.total).toBe(0.87);
  });

  it("exposes weights on the score for UI tooltip use", () => {
    const s = computeFitScore(baseRole, baseProfile);
    expect(s.weights).toEqual(FIT_WEIGHTS);
  });
});

describe("computeFitScore — custom weights from profile", () => {
  it("falls back to FIT_WEIGHTS when profile has no weight fields", () => {
    // baseProfile has no fit_weight_* keys — should get the default.
    const s = computeFitScore(baseRole, baseProfile);
    expect(s.weights).toEqual(FIT_WEIGHTS);
  });

  it("normalizes raw slider values to a ratio summing to 1.0", () => {
    const profile = {
      ...baseProfile,
      fit_weight_class_year: 40,
      fit_weight_distance: 40,
      fit_weight_interest: 20,
    };
    const s = computeFitScore(baseRole, profile);
    expect(s.weights.classYear).toBeCloseTo(0.4, 5);
    expect(s.weights.distance).toBeCloseTo(0.4, 5);
    expect(s.weights.interest).toBeCloseTo(0.2, 5);
    expect(
      s.weights.classYear + s.weights.distance + s.weights.interest
    ).toBeCloseTo(1, 5);
  });

  it("treats non-percentage raw values (e.g. 100/100/100) as equal thirds", () => {
    const profile = {
      ...baseProfile,
      fit_weight_class_year: 100,
      fit_weight_distance: 100,
      fit_weight_interest: 100,
    };
    const s = computeFitScore(baseRole, profile);
    expect(s.weights.classYear).toBeCloseTo(1 / 3, 5);
    expect(s.weights.distance).toBeCloseTo(1 / 3, 5);
    expect(s.weights.interest).toBeCloseTo(1 / 3, 5);
  });

  it("zeros a component when its slider is 0 (opt-out)", () => {
    const profile = {
      ...baseProfile,
      fit_weight_class_year: 50,
      fit_weight_distance: 50,
      fit_weight_interest: 0,
    };
    const s = computeFitScore(baseRole, profile);
    expect(s.weights.interest).toBe(0);
    expect(s.weights.classYear).toBeCloseTo(0.5, 5);
    expect(s.weights.distance).toBeCloseTo(0.5, 5);
  });

  it("falls back to defaults when every slider is 0 (guard against divide-by-zero)", () => {
    const profile = {
      ...baseProfile,
      fit_weight_class_year: 0,
      fit_weight_distance: 0,
      fit_weight_interest: 0,
    };
    const s = computeFitScore(baseRole, profile);
    expect(s.weights).toEqual(FIT_WEIGHTS);
  });

  it("changes the total when weights shift", () => {
    // Same components, different weights → different totals.
    const role = {
      ...baseRole,
      locations: [{ text: "NYC", lat: NYC_LAT, lng: NYC_LNG }],
    };
    const balanced = computeFitScore(role, {
      ...baseProfile,
      fit_weight_class_year: 50,
      fit_weight_distance: 30,
      fit_weight_interest: 20,
    });
    const distanceHeavy = computeFitScore(role, {
      ...baseProfile,
      fit_weight_class_year: 10,
      fit_weight_distance: 80,
      fit_weight_interest: 10,
    });
    // Both perfect class-year + distance, neutral interest; distance-heavy
    // should score higher (weighs the strong signal more).
    expect(distanceHeavy.total).toBeGreaterThan(balanced.total);
  });
});
