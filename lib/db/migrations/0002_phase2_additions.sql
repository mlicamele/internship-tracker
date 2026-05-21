-- ============================================================
-- 0002_phase2_additions.sql
-- ============================================================
-- Adds, on top of 0001_init:
--   * Role fields: target_year, target_season, work_model,
--     compensation_text, compensation_hourly_cents
--   * interviews table (data capture only; interview prep
--     tracking stays in v2)
--   * company_notes table (per-user notes about a company,
--     survives across applications to that company)
--
-- Apply once via Supabase dashboard SQL Editor.
-- ============================================================


-- ---------- New enums ----------
CREATE TYPE target_season AS ENUM ('summer', 'fall', 'winter', 'spring');
CREATE TYPE work_model AS ENUM ('remote', 'hybrid', 'onsite', 'unspecified');
CREATE TYPE interview_type AS ENUM (
  'phone_screen',
  'technical',
  'behavioral',
  'system_design',
  'onsite',
  'final',
  'other'
);


-- ---------- Roles: new columns ----------
ALTER TABLE roles
  ADD COLUMN target_year INTEGER,
  ADD COLUMN target_season target_season NOT NULL DEFAULT 'summer',
  ADD COLUMN work_model work_model NOT NULL DEFAULT 'unspecified',
  ADD COLUMN compensation_text TEXT,
  ADD COLUMN compensation_hourly_cents INTEGER;

-- Helpful index for target-term filtering (most queries scope to a single cohort)
CREATE INDEX idx_roles_target ON roles (target_year, target_season);


-- ---------- Interviews ----------
-- scheduled_at is nullable so a user can log a "phone screen requested,
-- time TBD" interview and fill in the time later.
CREATE TABLE interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type interview_type NOT NULL DEFAULT 'other',
  scheduled_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  meeting_url TEXT,
  location TEXT,
  interviewer_names TEXT,
  notes TEXT NOT NULL DEFAULT '',
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interviews_application
  ON interviews (application_id, scheduled_at);

CREATE TRIGGER interviews_set_updated_at
  BEFORE UPDATE ON interviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------- Company notes ----------
-- Per-user notes about a company, distinct from per-application notes.
-- Composite PK (user_id, company_id) since each user has at most one
-- note row per company.
CREATE TABLE company_notes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_id)
);

CREATE TRIGGER company_notes_set_updated_at
  BEFORE UPDATE ON company_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------- Row Level Security ----------
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_notes ENABLE ROW LEVEL SECURITY;


-- interviews: gated through the parent application
CREATE POLICY interviews_select_own ON interviews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = interviews.application_id
        AND applications.user_id = auth.uid()
    )
  );
CREATE POLICY interviews_insert_own ON interviews
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = interviews.application_id
        AND applications.user_id = auth.uid()
    )
  );
CREATE POLICY interviews_update_own ON interviews
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = interviews.application_id
        AND applications.user_id = auth.uid()
    )
  );
CREATE POLICY interviews_delete_own ON interviews
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = interviews.application_id
        AND applications.user_id = auth.uid()
    )
  );


-- company_notes: user can CRUD own rows
CREATE POLICY company_notes_select_own ON company_notes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY company_notes_insert_own ON company_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY company_notes_update_own ON company_notes
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY company_notes_delete_own ON company_notes
  FOR DELETE USING (auth.uid() = user_id);
