-- ============================================================
-- 0001_init.sql — initial schema
-- ============================================================
-- Apply this from the Supabase dashboard SQL Editor.
-- Re-applying is NOT idempotent; run once per fresh project.
--
-- Tables:
--   profiles, companies, roles, resume_versions,
--   applications, status_events, contacts, application_contacts
--
-- RLS: user-scoped tables enforce auth.uid() = user_id.
-- Shared catalog tables (companies, roles) are read-only for
-- authenticated users; only the service role can write (used
-- by the Phase 5 scraper).
-- ============================================================


-- ---------- Enums ----------
CREATE TYPE relocation_tolerance AS ENUM ('nope', 'regional', 'anywhere');
CREATE TYPE class_year_tag AS ENUM ('freshman_ok', 'sophomore_ok', 'junior_plus', 'unspecified');
CREATE TYPE role_source AS ENUM ('paste_url', 'scrape_simplify', 'manual');
CREATE TYPE triage_state AS ENUM ('inbox', 'active', 'snoozed', 'skipped');
CREATE TYPE application_status AS ENUM (
  'saved', 'applied', 'oa', 'phone', 'technical',
  'final', 'offer', 'reject', 'ghosted'
);


-- ---------- profiles ----------
-- school and grad_year are nullable so a row can be auto-created
-- on signup and filled in during the onboarding wizard.
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  school TEXT,
  grad_year INTEGER,
  home_address TEXT,
  home_lat NUMERIC(9, 6),
  home_lng NUMERIC(9, 6),
  local_radius_miles INTEGER NOT NULL DEFAULT 30,
  relocation_tolerance relocation_tolerance NOT NULL DEFAULT 'regional',
  interest_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  onboarding_completed_at TIMESTAMPTZ
);


-- ---------- companies (shared catalog) ----------
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  industry_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  hq_city TEXT,
  hq_lat NUMERIC(9, 6),
  hq_lng NUMERIC(9, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------- roles (shared catalog) ----------
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  location_text TEXT,
  role_lat NUMERIC(9, 6),
  role_lng NUMERIC(9, 6),
  jd_url TEXT,
  jd_body_text TEXT,
  jd_snapshot_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  class_year_tag class_year_tag NOT NULL DEFAULT 'unspecified',
  class_year_confidence NUMERIC(3, 2),
  source role_source NOT NULL,
  source_external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------- resume_versions ----------
CREATE TABLE resume_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_master BOOLEAN NOT NULL DEFAULT FALSE
);

-- One master resume per user (partial unique index)
CREATE UNIQUE INDEX idx_resume_versions_one_master_per_user
  ON resume_versions (user_id)
  WHERE is_master = TRUE;


-- ---------- applications ----------
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resume_version_id UUID REFERENCES resume_versions(id) ON DELETE SET NULL,
  triage_state triage_state NOT NULL DEFAULT 'active',
  status application_status NOT NULL DEFAULT 'saved',
  snoozed_until TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  fit_score NUMERIC(5, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role_id)
);


-- ---------- status_events ----------
CREATE TABLE status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status application_status,
  to_status application_status NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT
);


-- ---------- contacts ----------
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role_title TEXT,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  email TEXT,
  linkedin_url TEXT,
  last_contact_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------- application_contacts (M:N) ----------
CREATE TABLE application_contacts (
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (application_id, contact_id)
);


-- ---------- Indexes ----------
CREATE INDEX idx_applications_user_triage
  ON applications (user_id, triage_state, created_at DESC);

CREATE INDEX idx_roles_deadline
  ON roles (deadline_at);

CREATE INDEX idx_roles_source_external
  ON roles (source, source_external_id);


-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER applications_set_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------- Auto-create empty profile on signup ----------
-- Lets the middleware redirect freshly-signed-up users straight
-- to /onboard without the app needing to insert a profile row.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Backfill profiles for any users that existed before this migration
-- (e.g. accounts created during Phase 0 auth testing).
INSERT INTO public.profiles (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;


-- ---------- Row Level Security ----------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_contacts ENABLE ROW LEVEL SECURITY;


-- profiles: user can CRUD own row
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY profiles_insert_own ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY profiles_delete_own ON profiles
  FOR DELETE USING (auth.uid() = user_id);


-- applications: user can CRUD own rows
CREATE POLICY applications_select_own ON applications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY applications_insert_own ON applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY applications_update_own ON applications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY applications_delete_own ON applications
  FOR DELETE USING (auth.uid() = user_id);


-- status_events: gated through the parent application
CREATE POLICY status_events_select_own ON status_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = status_events.application_id
        AND applications.user_id = auth.uid()
    )
  );
CREATE POLICY status_events_insert_own ON status_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = status_events.application_id
        AND applications.user_id = auth.uid()
    )
  );
-- status_events are append-only; no UPDATE/DELETE policies


-- resume_versions: user can CRUD own rows
CREATE POLICY resume_versions_select_own ON resume_versions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY resume_versions_insert_own ON resume_versions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY resume_versions_update_own ON resume_versions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY resume_versions_delete_own ON resume_versions
  FOR DELETE USING (auth.uid() = user_id);


-- contacts: user can CRUD own rows
CREATE POLICY contacts_select_own ON contacts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY contacts_insert_own ON contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY contacts_update_own ON contacts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY contacts_delete_own ON contacts
  FOR DELETE USING (auth.uid() = user_id);


-- application_contacts: gated through the parent application
CREATE POLICY application_contacts_select_own ON application_contacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_contacts.application_id
        AND applications.user_id = auth.uid()
    )
  );
CREATE POLICY application_contacts_insert_own ON application_contacts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_contacts.application_id
        AND applications.user_id = auth.uid()
    )
  );
CREATE POLICY application_contacts_delete_own ON application_contacts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_contacts.application_id
        AND applications.user_id = auth.uid()
    )
  );


-- Shared catalog: any authenticated user can read; writes are
-- service-role only (which bypasses RLS), used by the Phase 5 scraper.
CREATE POLICY companies_select_authenticated ON companies
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY roles_select_authenticated ON roles
  FOR SELECT TO authenticated USING (TRUE);
