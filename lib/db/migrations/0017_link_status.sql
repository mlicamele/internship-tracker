-- ============================================================
-- 0017_link_status.sql
-- ============================================================
-- Adds link-validation state to roles. A nightly validator will
-- probe jd_url on triage_state IN ('inbox','active','snoozed')
-- and surface dead / suspect links as badges in the UI. We do NOT
-- auto-drop until detection is proven reliable — badge + one-click
-- dismiss only.
--
-- link_status is kept SEPARATE from triage_state so detection
-- facts ("the URL 404s") don't conflate with workflow ("I've
-- decided to skip this role"). A dead link + inbox is a valid
-- combination — it means "posting died, hasn't been triaged yet."
--
-- Values:
--   'unknown' — not yet checked (default for existing + newly-
--               scraped roles)
--   'live'    — probe returned a real posting body / board API 200
--   'dead'    — board API 404, or HTTP 4xx/5xx, or redirect to a
--               careers index, or a soft-404 body ("no longer
--               accepting", "position closed", etc.)
--   'suspect' — ambiguous signal — bot-walled response, empty
--               body, or a body that doesn't obviously look like
--               a JD. Human should look.
--
-- link_checked_at is the timestamp of the last probe. Null while
-- link_status = 'unknown'.
--
-- Apply in Supabase SQL Editor BEFORE deploying dependent code
-- (the /api/cron/validate-links endpoint and the badge queries).
-- ============================================================

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS link_status     TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS link_checked_at TIMESTAMPTZ;

-- Partial index — the validator and UI queries only ever filter on
-- non-live rows (badge display, and "which ones need rechecking").
-- Keeps the index tiny.
CREATE INDEX IF NOT EXISTS idx_roles_link_status_nonlive
  ON roles (link_status)
  WHERE link_status <> 'live';
