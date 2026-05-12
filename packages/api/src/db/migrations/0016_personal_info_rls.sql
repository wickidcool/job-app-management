-- Migration: 0016_personal_info_rls.sql
-- Add Supabase-specific RLS policies and auth.users FK for personal_info table
-- Applied after 0014_fix_personal_info_schema.sql creates the table

-- Add FK constraint to auth.users (Supabase multi-tenancy)
-- Only add if the constraint doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_personal_info_user_id'
    AND table_name = 'personal_info'
  ) THEN
    ALTER TABLE personal_info
      ADD CONSTRAINT fk_personal_info_user_id
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Enable Row-Level Security
ALTER TABLE personal_info ENABLE ROW LEVEL SECURITY;

-- Create RLS policy: Users can only see and modify their own personal info
-- Drop first if it exists to make migration idempotent
DROP POLICY IF EXISTS personal_info_isolation ON personal_info;

CREATE POLICY personal_info_isolation ON personal_info
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Journal entry
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('0016_personal_info_rls', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (hash) DO NOTHING;
