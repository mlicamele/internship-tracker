-- Migration 0008: collapse "unspecified" into NULL for enum fields
--
-- Storing a sentinel "unspecified" value alongside actual unknowns (NULL)
-- is duplication. The UI already renders both as "—", so make the data
-- match: drop the sentinel, allow NULL.

-- work_model
ALTER TABLE roles ALTER COLUMN work_model DROP NOT NULL;
ALTER TABLE roles ALTER COLUMN work_model DROP DEFAULT;
UPDATE roles SET work_model = NULL WHERE work_model = 'unspecified';

-- relocation_assistance (added in 0006 with a CHECK; need to relax it)
ALTER TABLE roles ALTER COLUMN relocation_assistance DROP NOT NULL;
ALTER TABLE roles ALTER COLUMN relocation_assistance DROP DEFAULT;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_relocation_assistance_check;
UPDATE roles SET relocation_assistance = NULL WHERE relocation_assistance = 'unspecified';
ALTER TABLE roles ADD CONSTRAINT roles_relocation_assistance_check
  CHECK (relocation_assistance IS NULL OR relocation_assistance IN ('provided', 'not_provided'));
