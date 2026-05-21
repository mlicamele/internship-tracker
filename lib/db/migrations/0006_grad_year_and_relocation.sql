-- Migration 0006: replace class_year_tag with max_grad_year + add relocation_assistance
--
-- Why max_grad_year:
--   class_year_tag (freshman_ok / sophomore_ok / junior_plus) drifts after each
--   summer — a "freshman_ok" tag set today means something different in a year.
--   max_grad_year encodes the role's eligibility by the *latest graduation year
--   still acceptable*, which is stable across time.
--
--   Examples:
--     "Rising junior+ for Summer 2027" → max_grad_year = 2029
--     "Senior only / graduating in 2027" → max_grad_year = 2027
--     "Any undergraduate year" → max_grad_year = NULL (open to all)
--
--   User qualifies iff user.grad_year <= role.max_grad_year (or max is NULL).
--
-- Why relocation_assistance:
--   Tells us whether the company supports the candidate moving for the role
--   (housing stipend, relocation reimbursement, visa support, etc).
--   Independent of work_model — a remote role obviously doesn't need
--   relocation, but onsite/hybrid roles may or may not.

ALTER TABLE roles ADD COLUMN max_grad_year INTEGER;
ALTER TABLE roles ADD COLUMN relocation_assistance TEXT NOT NULL DEFAULT 'unspecified'
  CHECK (relocation_assistance IN ('provided', 'not_provided', 'unspecified'));

-- Per-field LLM extraction confidences. Single JSONB blob so we don't have
-- to migrate every time we add a field. Shape: { fieldName: 0.0..1.0 }.
-- Cleared per-field when the user edits a field manually (the cell formatter
-- treats absence as "no extraction signal").
ALTER TABLE roles ADD COLUMN extraction_confidences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Best-effort backfill: map the old enum to a max_grad_year window based on
-- the role's target_year. (Drops to NULL if target_year is missing.)
--   junior_plus  → up to 2 years away from target (rising junior+)
--   sophomore_ok → up to 3 years away (rising sophomore+)
--   freshman_ok  → NULL (open)
--   unspecified  → NULL
UPDATE roles
SET max_grad_year = CASE
  WHEN class_year_tag = 'junior_plus' AND target_year IS NOT NULL
    THEN target_year + 2
  WHEN class_year_tag = 'sophomore_ok' AND target_year IS NOT NULL
    THEN target_year + 3
  ELSE NULL
END
WHERE class_year_tag IN ('junior_plus', 'sophomore_ok');

ALTER TABLE roles DROP COLUMN class_year_tag;
ALTER TABLE roles DROP COLUMN class_year_confidence;
