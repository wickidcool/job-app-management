-- Migration: 0014_fix_personal_info_schema.sql
-- Replaces personal_info table with the correct schema from PERSONAL_INFO_API.md
-- Aligns database with E2E tests, frontend types, and API documentation

-- Idempotency guard (WIC-930): only rebuild personal_info if it still has the
-- OLD 0013 shape. The new schema is uniquely identified by the `first_name`
-- column. Without this guard, a CI/prod replay of this migration would
-- DROP TABLE personal_info CASCADE on the already-correct table and destroy
-- live user data. If the new schema is already present, this migration is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'personal_info' AND column_name = 'first_name'
  ) THEN
    -- Drop the incorrect table from migration 0013
    DROP TABLE IF EXISTS personal_info CASCADE;

    -- Create personal_info with the documented schema
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
  END IF;
END$$;

-- NOTE: manual __drizzle_migrations self-record removed — drizzle migrate()
-- records this file itself, and the ON CONFLICT (hash) form errors under CI. (WIC-930)
