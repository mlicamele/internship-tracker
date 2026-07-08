-- ============================================================
-- 0014_user_fit_weights.sql
-- ============================================================
-- Lets users tune how the fit score is calculated. Three integer
-- weights (0..100 slider positions) that computeFitScore normalizes
-- to a ratio at compute time. Defaults mirror the previous hardcoded
-- FIT_WEIGHTS (50/30/20).
--
-- INTEGER (not NUMERIC) so slider position round-trips cleanly and
-- the columns compare cheaply in indexes. Normalize at read time in
-- lib/scoring/fit.ts.
--
-- Apply in Supabase SQL Editor BEFORE deploying dependent code.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS fit_weight_class_year INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS fit_weight_distance   INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS fit_weight_interest   INTEGER NOT NULL DEFAULT 20;

-- Non-negative constraint so a UI bug or bad SQL can't crash the compute
-- layer with a negative ratio.
ALTER TABLE profiles
  ADD CONSTRAINT fit_weights_non_negative CHECK (
    fit_weight_class_year >= 0
    AND fit_weight_distance >= 0
    AND fit_weight_interest >= 0
    AND (fit_weight_class_year + fit_weight_distance + fit_weight_interest) > 0
  );
