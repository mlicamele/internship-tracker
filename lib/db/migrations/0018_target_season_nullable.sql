-- Migration 0018: Make roles.target_season nullable.
--
-- Rationale: the "summer" default (migration 0002) was a domain shortcut for a
-- summer-2027-focused tracker, but it made "LLM couldn't identify a season"
-- indistinguishable from "confirmed summer" everywhere in the UI. That was the
-- mechanism behind a per-field revert-button UX bug: extraction snapshot faithfully
-- stored null while the DB current value was "summer" (from the default), so the
-- revert affordance appeared and offered to *destroy* the working default.
--
-- After this migration:
--   * Extractor emits null when the JD doesn't state a season (or valid enum).
--   * DB stores null verbatim; UI renders "—" for that state.
--   * "summer" only shows up when it's either explicitly extracted or explicitly picked.
--
-- Existing rows are untouched — the vast majority currently sit at "summer" (which
-- may or may not be actually correct); leave them alone rather than mass-nulling.
-- Users can revert per-field going forward, or the extractor re-run script can
-- re-populate from evidence.

ALTER TABLE roles ALTER COLUMN target_season DROP DEFAULT;
ALTER TABLE roles ALTER COLUMN target_season DROP NOT NULL;
