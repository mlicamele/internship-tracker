-- ============================================================
-- 0016_resume_fit_and_combined_weights.sql
-- ============================================================
-- Phase 3B. Adds the resume-fit metric — a distinct axis from
-- fit_score. Resume-fit answers "how much does the role want the
-- user" (skills coverage, seniority, keyword depth) vs the existing
-- fit_score which answers "how much does the user want the role"
-- (class-year eligibility, distance, interest overlap).
--
-- Also adds two profile-level 0-100 sliders that control the
-- weighted combination of fit and resume-fit into a single
-- "combined" score. Combined is computed at read time from the two
-- component scores and the weights — no materialized column — so
-- moving a slider does NOT trigger a rescore.
--
-- Apply in Supabase SQL Editor BEFORE deploying dependent code.
-- ============================================================

-- ------------------------------------------------------------
-- applications: resume-fit persistence + cache key
-- ------------------------------------------------------------
-- resume_fit_score:   0-100 numeric, deterministically composed
--                     from LLM-emitted rubric component tiers
--                     (see lib/scoring/resume-fit.ts). Null when
--                     scoring was skipped (no resume; insufficient
--                     signal).
-- resume_fit_details: JSONB payload:
--                       { tier: 'strong'|'partial'|'weak'|'insufficient',
--                         skills_coverage, seniority_match, depth_signal,
--                         keyword_hit_count, matched_skills[], gaps[],
--                         rationale, resume_version_id_used }
-- resume_fit_scored_at: last successful score timestamp; null when
--                       insufficient-signal short-circuit.
-- resume_fit_input_hash: sha256 hex of the score inputs (resume
--                        version + normalized role tags + normalized
--                        jd_body_text). Used to skip re-scoring
--                        pairs whose inputs haven't changed.
-- ------------------------------------------------------------

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS resume_fit_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS resume_fit_details JSONB,
  ADD COLUMN IF NOT EXISTS resume_fit_scored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resume_fit_input_hash TEXT;

-- ------------------------------------------------------------
-- profiles: combined-score weights (0-100 sliders, default 50/50)
-- ------------------------------------------------------------
-- Raw slider positions; normalized to sum 1.0 at read time in
-- lib/scoring/combined.ts. Mirrors the fit_weight_* pattern from
-- migration 0014.
-- ------------------------------------------------------------

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS combined_weight_fit    INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS combined_weight_resume INTEGER NOT NULL DEFAULT 50;
