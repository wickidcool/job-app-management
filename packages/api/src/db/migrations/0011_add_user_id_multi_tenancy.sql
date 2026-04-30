-- Migration: 0011_add_user_id_multi_tenancy.sql
-- Adds user_id UUID columns to all user-owned tables for multi-tenancy support.
-- FK references to auth.users and RLS policies are applied separately in
-- supabase/migrations/0001_rls_user_isolation.sql (Supabase-specific).

-- ============================================================================
-- STEP 1: Add user_id columns (nullable for backward compat with local dev data)
-- ============================================================================

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE status_history
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE resume_exports
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- Additional catalog and document tables
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE company_catalog
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE job_fit_tags
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE tech_stack_tags
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE quantified_bullets
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE recurring_themes
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE catalog_change_log
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE catalog_diffs
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE wikilink_registry
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE cover_letters
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE outreach_messages
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE resume_variants
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE interview_preps
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE interview_prep_stories
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE prep_question_story_links
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- ============================================================================
-- STEP 2: Create indexes for user_id queries (performance)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_status ON applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_user_updated ON applications(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_status_history_user_id ON status_history(user_id);

CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);

CREATE INDEX IF NOT EXISTS idx_resume_exports_user_id ON resume_exports(user_id);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

CREATE INDEX IF NOT EXISTS idx_company_catalog_user_id ON company_catalog(user_id);
CREATE INDEX IF NOT EXISTS idx_company_catalog_user_name ON company_catalog(user_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_job_fit_tags_user_id ON job_fit_tags(user_id);

CREATE INDEX IF NOT EXISTS idx_tech_stack_tags_user_id ON tech_stack_tags(user_id);

CREATE INDEX IF NOT EXISTS idx_quantified_bullets_user_id ON quantified_bullets(user_id);

CREATE INDEX IF NOT EXISTS idx_recurring_themes_user_id ON recurring_themes(user_id);

CREATE INDEX IF NOT EXISTS idx_catalog_change_log_user_id ON catalog_change_log(user_id);

CREATE INDEX IF NOT EXISTS idx_catalog_diffs_user_id ON catalog_diffs(user_id);

CREATE INDEX IF NOT EXISTS idx_wikilink_registry_user_id ON wikilink_registry(user_id);

CREATE INDEX IF NOT EXISTS idx_cover_letters_user_id ON cover_letters(user_id);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_user_id ON outreach_messages(user_id);

CREATE INDEX IF NOT EXISTS idx_resume_variants_user_id ON resume_variants(user_id);

CREATE INDEX IF NOT EXISTS idx_interview_preps_user_id ON interview_preps(user_id);

CREATE INDEX IF NOT EXISTS idx_interview_prep_stories_user_id ON interview_prep_stories(user_id);

CREATE INDEX IF NOT EXISTS idx_prep_question_story_links_user_id ON prep_question_story_links(user_id);
