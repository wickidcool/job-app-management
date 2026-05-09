-- Migration: 0014_fix_personal_info_schema.sql
-- Replaces personal_info table with the correct schema from PERSONAL_INFO_API.md
-- Aligns database with E2E tests, frontend types, and API documentation

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

-- Journal entry
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('0014_fix_personal_info_schema', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (hash) DO NOTHING;
