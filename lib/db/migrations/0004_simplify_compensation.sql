-- ============================================================
-- 0004_simplify_compensation.sql
-- ============================================================
-- Per Michael's feedback: a single integer hourly-dollar field is
-- enough. Drop the redundant compensation_text + compensation_hourly_cents.
--
-- Apply via Supabase dashboard SQL Editor.
-- ============================================================

-- Add new column (whole dollars per hour; null if not stated or non-numeric)
ALTER TABLE roles ADD COLUMN compensation_hourly_dollars INTEGER;

-- Backfill from existing cents column if any rows have data
UPDATE roles
SET compensation_hourly_dollars = ROUND(compensation_hourly_cents::numeric / 100)::integer
WHERE compensation_hourly_cents IS NOT NULL;

-- Drop the old, now-redundant columns
ALTER TABLE roles DROP COLUMN compensation_text;
ALTER TABLE roles DROP COLUMN compensation_hourly_cents;
