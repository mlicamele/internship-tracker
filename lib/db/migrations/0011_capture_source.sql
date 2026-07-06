-- ============================================================
-- 0011_capture_source.sql — add 'capture' to role_source enum
-- ============================================================
-- Roles that land via the /api/capture endpoint (iOS Shortcut,
-- share-sheet forwarding, etc.) should be distinguishable from
-- manual paste-URL entries and from the SimplifyJobs scraper.
-- Apply in Supabase SQL Editor before deploying code.
-- ============================================================

ALTER TYPE role_source ADD VALUE IF NOT EXISTS 'capture';
