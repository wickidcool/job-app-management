-- Add emphasis enum and column to cover_letters
DO $$ BEGIN
  CREATE TYPE emphasis_preference AS ENUM ('technical', 'leadership', 'balanced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE cover_letters
  ADD COLUMN IF NOT EXISTS emphasis emphasis_preference NOT NULL DEFAULT 'balanced';
