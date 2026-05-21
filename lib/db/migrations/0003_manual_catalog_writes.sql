-- ============================================================
-- 0003_manual_catalog_writes.sql
-- ============================================================
-- Bug fix: 0001_init's RLS policies on `companies` and `roles`
-- only allowed SELECT for authenticated users (the intent was that
-- writes go through the Phase 5 scraper using the service-role key,
-- which bypasses RLS).
--
-- But the manual "New application" form (Phase 2 Track 2-B) needs
-- regular authenticated users to insert/update these rows. Without
-- these policies, submission fails with:
--   "new row violates row-level security policy for table ..."
--
-- These policies allow any authenticated user to read AND write
-- shared catalog rows. Multi-user pollution risk is acceptable
-- for v1 single-user. Revisit in V2 with stricter ownership if/when
-- the app gets shared.
-- ============================================================

CREATE POLICY companies_insert_authenticated ON companies
  FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE POLICY companies_update_authenticated ON companies
  FOR UPDATE TO authenticated USING (TRUE);

CREATE POLICY roles_insert_authenticated ON roles
  FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE POLICY roles_update_authenticated ON roles
  FOR UPDATE TO authenticated USING (TRUE);
