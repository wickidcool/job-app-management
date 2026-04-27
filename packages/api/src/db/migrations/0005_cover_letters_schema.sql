-- Cover letter enums
DO $$ BEGIN
  CREATE TYPE cover_letter_status AS ENUM ('draft', 'finalized');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tone_preference AS ENUM ('professional', 'conversational', 'enthusiastic', 'technical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE length_variant AS ENUM ('concise', 'standard', 'detailed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outreach_platform AS ENUM ('linkedin', 'email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cover letters table
CREATE TABLE IF NOT EXISTS cover_letters (
  id                      TEXT PRIMARY KEY,
  status                  cover_letter_status NOT NULL DEFAULT 'draft',
  title                   TEXT NOT NULL,
  target_company          TEXT NOT NULL,
  target_role             TEXT NOT NULL,
  tone                    tone_preference NOT NULL DEFAULT 'professional',
  length_variant          length_variant NOT NULL DEFAULT 'standard',
  job_description_text    TEXT,
  job_description_url     TEXT,
  job_fit_analysis_id     TEXT,
  selected_star_entry_ids JSONB NOT NULL DEFAULT '[]',
  content                 TEXT NOT NULL,
  revision_history        JSONB NOT NULL DEFAULT '[]',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version                 INTEGER NOT NULL DEFAULT 1
);

-- Outreach messages table
CREATE TABLE IF NOT EXISTS outreach_messages (
  id                  TEXT PRIMARY KEY,
  platform            outreach_platform NOT NULL,
  target_company      TEXT NOT NULL,
  target_role         TEXT,
  target_name         TEXT,
  target_title        TEXT,
  cover_letter_id     TEXT REFERENCES cover_letters(id) ON DELETE SET NULL,
  job_fit_analysis_id TEXT,
  subject             TEXT,
  body                TEXT NOT NULL,
  character_count     INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
