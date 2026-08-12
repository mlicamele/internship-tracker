-- Migration 0019: Distance-tier score overrides.
--
-- Reworks the distance component of fit-scoring from a continuous linear
-- decay (see prior lib/scoring/fit.ts) into a 4-tier model with a preset
-- selector (existing relocation_tolerance) and optional per-tier overrides.
--
-- Preset defaults live in code (lib/scoring/fit.ts PRESET_TIER_SCORES).
-- Null in these columns → the preset value applies for that tier. Set →
-- override wins for that tier.
--
-- Rationale: the linear decay + hard clamp punished moderate distances
-- more sharply than users' actual mental model, and zeroed out roles
-- beyond a threshold — turning distance into a disqualifier rather than
-- a soft preference. Tiers with a floor let users express "prefer close
-- but don't kill far things" and give a categorical UI that matches how
-- people actually reason about geography.
--
-- Spec: docs/superpowers/specs/2026-08-12-distance-scoring-tiers-design.md
--
-- Existing rows unaffected: all four columns are nullable with no default,
-- so existing profiles fall through to preset defaults from
-- relocation_tolerance until the user opens the Advanced overrides UI.

ALTER TABLE profiles
  ADD COLUMN fit_dist_tier_score_commutable numeric(3,2),
  ADD COLUMN fit_dist_tier_score_regional   numeric(3,2),
  ADD COLUMN fit_dist_tier_score_domestic   numeric(3,2),
  ADD COLUMN fit_dist_tier_score_distant    numeric(3,2);
