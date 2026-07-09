-- ============================================================
-- 0015_resume_extracted_text_and_storage.sql
-- ============================================================
-- Phase 6-A resume upload. Adds two columns to resume_versions:
--   - extracted_text: pdf-parse output cached at upload time so
--     downstream fit scoring / bullet-suggestion doesn't re-parse
--     the PDF on every read.
--   - mime_type: defensive for a future non-PDF upload (docx, etc).
--     Defaults to application/pdf so existing rows are consistent.
--
-- Also provisions the private `resumes` storage bucket and the
-- four owner-scoped RLS policies on storage.objects that gate it.
-- Objects live under `{user_id}/{resume_version_id}.pdf` so the
-- first path segment is the auth check.
--
-- One RPC (set_master_resume_version) exists because the partial
-- unique index on (user_id) WHERE is_master requires a single
-- statement to flip old master off and new master on atomically;
-- supabase-js .update() can't express a column-referencing SET.
--
-- Apply in Supabase SQL Editor BEFORE deploying dependent code.
-- ============================================================

ALTER TABLE resume_versions
  ADD COLUMN IF NOT EXISTS extracted_text TEXT;

ALTER TABLE resume_versions
  ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/pdf';

-- ------------------------------------------------------------
-- Storage bucket
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- Storage RLS: owner-scoped by first path segment == auth.uid()
-- ------------------------------------------------------------

DROP POLICY IF EXISTS resumes_select_own ON storage.objects;
CREATE POLICY resumes_select_own ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS resumes_insert_own ON storage.objects;
CREATE POLICY resumes_insert_own ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS resumes_update_own ON storage.objects;
CREATE POLICY resumes_update_own ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS resumes_delete_own ON storage.objects;
CREATE POLICY resumes_delete_own ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------
-- Atomic master-flip RPC. Single UPDATE so the partial unique
-- index (user_id) WHERE is_master evaluates at statement end
-- rather than per-row. SECURITY INVOKER keeps RLS enforced.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_master_resume_version(
  target_user_id UUID,
  target_id UUID
) RETURNS VOID
LANGUAGE SQL
SECURITY INVOKER
AS $$
  UPDATE resume_versions
     SET is_master = (id = target_id)
   WHERE user_id = target_user_id;
$$;
