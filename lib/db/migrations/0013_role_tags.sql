-- ============================================================
-- 0013_role_tags.sql
-- ============================================================
-- Phase 3 (fit scoring): adds a role-level tag column drawn from the
-- shared INTEREST_TAGS vocabulary in lib/taxonomy.ts.
--
-- Both `profiles.interest_tags` and `roles.tags` use the same closed
-- vocabulary, so the interest-fit term in the score reduces to a plain
-- set intersection with no synonym mapping.
--
-- The LLM extractor emits 0-4 tags per role from the vocabulary;
-- filtered client-side to valid values before insert.
--
-- Apply in Supabase SQL Editor BEFORE deploying the extractor + fit
-- scoring code that depends on this column.
-- ============================================================

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Enables 'roles with any-of these tags' filtering in the pipeline.
CREATE INDEX IF NOT EXISTS idx_roles_tags ON roles USING GIN (tags);
