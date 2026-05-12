-- Add personal_info table with user data isolation support
-- Related migrations: packages/api/src/db/migrations/0014_fix_personal_info_schema.sql, 0015_onboarding_personal_info_step.sql

-- ============================================================================
-- STEP 1: Create personal_info table
-- ============================================================================

CREATE TABLE personal_info (
  id                   TEXT PRIMARY KEY,
  user_id              UUID,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  phone                TEXT,
  address_line1        TEXT,
  address_line2        TEXT,
  city                 TEXT,
  state                TEXT,
  postal_code          TEXT,
  country              TEXT,
  linkedin_url         TEXT,
  github_url           TEXT,
  portfolio_url        TEXT,
  website_url          TEXT,
  professional_summary TEXT,
  headline             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version              INTEGER NOT NULL DEFAULT 1
);

-- Add UNIQUE constraint on user_id (only for non-NULL values to support multi-user mode)
CREATE UNIQUE INDEX personal_info_user_id_unique ON personal_info(user_id) WHERE user_id IS NOT NULL;

-- Index for single-user lookup (user_id IS NULL)
CREATE INDEX personal_info_user_id_null ON personal_info(user_id) WHERE user_id IS NULL;

-- Trigger for auto-updating updated_at
CREATE TRIGGER personal_info_updated_at
  BEFORE UPDATE ON personal_info
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- STEP 2: Add FK constraint to auth.users and enable RLS
-- ============================================================================

ALTER TABLE personal_info
  ADD CONSTRAINT fk_personal_info_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE personal_info ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see and modify their own personal info
CREATE POLICY personal_info_isolation ON personal_info
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- STEP 3: Update onboarding_status for personal_info step
-- ============================================================================

-- Add 'personal_info' to onboarding_step enum if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'onboarding_status') THEN
    -- Add enum value if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'onboarding_step' AND e.enumlabel = 'personal_info'
    ) THEN
      ALTER TYPE onboarding_step ADD VALUE 'personal_info' AFTER 'welcome';
    END IF;

    -- Add tracking columns if they don't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'onboarding_status' AND column_name = 'personal_info_step_completed'
    ) THEN
      ALTER TABLE onboarding_status
        ADD COLUMN personal_info_step_completed BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN personal_info_step_skipped BOOLEAN NOT NULL DEFAULT false;
    END IF;
  END IF;
END$$;
