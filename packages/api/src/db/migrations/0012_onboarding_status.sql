-- Migration: 0012_onboarding_status.sql
-- Adds onboarding_status table to track user onboarding progress

-- Create onboarding_step enum
DO $$ BEGIN
  CREATE TYPE onboarding_step AS ENUM (
    'welcome',
    'resume_upload',
    'first_application',
    'completed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create onboarding_status table
CREATE TABLE IF NOT EXISTS onboarding_status (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  current_step onboarding_step NOT NULL DEFAULT 'welcome',
  resume_step_completed BOOLEAN NOT NULL DEFAULT FALSE,
  resume_step_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  application_step_completed BOOLEAN NOT NULL DEFAULT FALSE,
  application_step_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_onboarding_status_user_id ON onboarding_status(user_id);

-- NOTE: drizzle migrate() records this migration in drizzle.__drizzle_migrations
-- itself. The previous manual "INSERT ... ON CONFLICT (hash)" self-record was a
-- no-op under out-of-band application and errors under CI (the table has no
-- unique constraint on hash); removed so CI's migrate() can run this file. (WIC-930)
