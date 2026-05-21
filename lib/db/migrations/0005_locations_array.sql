-- Migration 0005: roles.location_text/role_lat/role_lng → roles.locations JSONB
--
-- Roles can have multiple locations (e.g. quant internships listed for NYC,
-- London, and Singapore). Storing as JSONB array of {text, lat, lng} lets us
-- compute weighted-nearest distance against multiple user-preferred
-- destinations without lossy concatenation.

ALTER TABLE roles ADD COLUMN locations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: wrap any existing single location into a one-element array
UPDATE roles
SET locations = CASE
  WHEN location_text IS NULL OR location_text = '' THEN '[]'::jsonb
  ELSE jsonb_build_array(
    jsonb_build_object(
      'text', location_text,
      'lat', role_lat,
      'lng', role_lng
    )
  )
END;

ALTER TABLE roles DROP COLUMN location_text;
ALTER TABLE roles DROP COLUMN role_lat;
ALTER TABLE roles DROP COLUMN role_lng;
