-- ============================================================
-- 0012_scrape_simplify_unique.sql
-- ============================================================
-- Phase 5 (SimplifyJobs cron): make the dedup key on
-- roles(source, source_external_id) a UNIQUE partial index so
-- concurrent cron / seed runs cannot create duplicate role rows
-- for the same upstream posting. `source_external_id` is null
-- for manual and paste_url roles, so partial-on-not-null is the
-- right constraint.
--
-- Apply in Supabase SQL Editor BEFORE deploying the cron.
-- ============================================================

DROP INDEX IF EXISTS idx_roles_source_external;

CREATE UNIQUE INDEX idx_roles_source_external
  ON roles (source, source_external_id)
  WHERE source_external_id IS NOT NULL;

