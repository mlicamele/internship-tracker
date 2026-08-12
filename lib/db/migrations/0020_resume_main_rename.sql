-- Migration 0020: Rename resume_versions.is_master → is_main.
--
-- "master" has connotations we're moving away from ("main" is the
-- ubiquitous replacement in git + AWS + GCP + etc). Renames the column,
-- the partial unique index, and the atomic-flip RPC. Purely cosmetic
-- at the data layer — no schema shape change, no data change.
--
-- Postgres updates internal index references by OID when you rename a
-- column, so the partial unique constraint keeps enforcing correctly
-- after the column rename. We rename the index for readability too.
--
-- The RPC has to be dropped + recreated (Postgres doesn't rename SQL
-- function bodies; the WHERE-clause literal `is_master` inside the
-- function body wouldn't match the renamed column anyway).
--
-- Apply BEFORE deploying dependent code — the app queries `is_main`
-- everywhere post-deploy and calls `set_main_resume_version()` RPC.
-- Old code (pre-deploy) queries `is_master` which no longer exists.

ALTER TABLE resume_versions RENAME COLUMN is_master TO is_main;

ALTER INDEX idx_resume_versions_one_master_per_user
  RENAME TO idx_resume_versions_one_main_per_user;

DROP FUNCTION IF EXISTS set_master_resume_version(UUID, UUID);

CREATE OR REPLACE FUNCTION set_main_resume_version(
  target_user_id UUID,
  target_id UUID
) RETURNS VOID
LANGUAGE SQL
SECURITY INVOKER
AS $$
  UPDATE resume_versions
     SET is_main = (id = target_id)
   WHERE user_id = target_user_id;
$$;
