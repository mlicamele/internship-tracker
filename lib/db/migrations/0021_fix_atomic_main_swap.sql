-- Migration 0021: Rewrite set_main_resume_version to be genuinely atomic
--   against the partial unique index on (user_id) WHERE is_main = TRUE.
--
-- Bug fixed: the previous single-statement UPDATE
--
--   UPDATE resume_versions SET is_main = (id = target_id) WHERE user_id = ...;
--
-- is NOT atomic against a partial unique index. Postgres doesn't guarantee
-- row-update order within one UPDATE statement, and an "insert" into a
-- partial index (a row transitioning FALSE → TRUE) is checked IMMEDIATELY,
-- not at statement end. If Postgres processes the incoming-main row before
-- the outgoing-main row, the new row enters the partial index while the
-- old row is still there → `duplicate key value violates unique constraint
-- "idx_resume_versions_one_main_per_user"` and the whole statement fails.
--
-- Symptom in prod: Set-as-main throws a 500 with the digest 1981412459@E394;
-- users see the "This page couldn't load" error boundary; no way to change
-- the main resume via the UI. Discovered 2026-08-13 after the upload UX
-- work exposed the Set-as-main path.
--
-- Fix: two SEPARATE statements inside the function body. Both run inside
-- the same implicit transaction (function bodies are transactional), so
-- the swap is still atomic from a caller's perspective. But each statement
-- ends with a clean state that the partial unique index accepts:
--
--   Statement 1: clear ALL is_main=TRUE for this user. After it commits,
--                nothing is in the partial index for this user. Safe.
--   Statement 2: set is_main=TRUE for the target row. After it commits,
--                exactly one row is in the partial index. Safe.
--
-- Cost: one extra roundtrip inside the DB is negligible. Safety win is
-- absolute — no more depending on Postgres's internal row ordering.
--
-- Apply in Supabase SQL Editor. No column/schema changes. Idempotent.

CREATE OR REPLACE FUNCTION set_main_resume_version(
  target_user_id UUID,
  target_id UUID
) RETURNS VOID
LANGUAGE SQL
SECURITY INVOKER
AS $$
  UPDATE resume_versions
     SET is_main = FALSE
   WHERE user_id = target_user_id
     AND is_main = TRUE;

  UPDATE resume_versions
     SET is_main = TRUE
   WHERE user_id = target_user_id
     AND id = target_id;
$$;
