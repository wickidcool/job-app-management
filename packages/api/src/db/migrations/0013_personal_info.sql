-- Migration: 0013_personal_info.sql
-- Adds personal_info table for user profile information

CREATE TABLE IF NOT EXISTS personal_info (
  id TEXT PRIMARY KEY,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  linkedin_url TEXT,
  github_url TEXT,
  home_address TEXT,
  phone_number TEXT,
  projects_website TEXT,
  publishing_platforms JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_personal_info_user_id ON personal_info(user_id);

-- Journal entry
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('0013_personal_info', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (hash) DO NOTHING;
