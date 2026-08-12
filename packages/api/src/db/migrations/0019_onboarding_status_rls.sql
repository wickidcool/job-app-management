-- Migration: 0019_onboarding_status_rls.sql
-- Enable Supabase Row-Level Security on the onboarding_status table (WIC-926).
-- This was the one remaining public table without RLS, flagged by the Supabase
-- Security Advisor ("Anyone with your project URL can read, edit, and delete all
-- data in this table because Row-Level Security is not enabled").
--
-- The Worker reaches Postgres over the postgres/owner role (via Hyperdrive), which
-- bypasses RLS, so enabling RLS here does NOT change the app's own queries. It
-- closes the auto-generated PostgREST/anon-key API surface for this table, matching
-- every other user-scoped table (see 0001_rls_user_isolation.sql / 0016_personal_info_rls.sql).
--
-- Applied after 0012_onboarding_status.sql creates the table.

-- Add FK constraint to auth.users (Supabase multi-tenancy).
-- Only add if the constraint doesn't already exist so the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_onboarding_status_user_id'
    AND table_name = 'onboarding_status'
  ) THEN
    ALTER TABLE onboarding_status
      ADD CONSTRAINT fk_onboarding_status_user_id
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Enable Row-Level Security.
ALTER TABLE onboarding_status ENABLE ROW LEVEL SECURITY;

-- Create RLS policy: users can only see and modify their own onboarding row.
-- Drop first if it exists to make the migration idempotent.
DROP POLICY IF EXISTS onboarding_status_isolation ON onboarding_status;

CREATE POLICY onboarding_status_isolation ON onboarding_status
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- NOTE: manual __drizzle_migrations self-record removed — this migration is now in
-- meta/_journal.json (idx 19), so drizzle migrate() records it itself. A NOW()-based
-- self-record would poison drizzle's MAX(created_at) watermark and skip future
-- migrations, and the ON CONFLICT (hash) form errors under CI. (WIC-930/WIC-933)
