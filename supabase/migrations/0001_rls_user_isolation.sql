-- Supabase-specific migration: Row-Level Security for user data isolation.
-- Applied via Supabase CLI or GitHub Actions deploy step.
-- Requires: auth.users table (provided by Supabase Auth).
-- Not compatible with plain local Docker PostgreSQL.

-- ============================================================================
-- STEP 1: Add FK constraints to auth.users
-- These reference the Supabase-managed auth.users table.
-- ============================================================================

ALTER TABLE applications
  ADD CONSTRAINT fk_applications_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE status_history
  ADD CONSTRAINT fk_status_history_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE resumes
  ADD CONSTRAINT fk_resumes_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE resume_exports
  ADD CONSTRAINT fk_resume_exports_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE projects
  ADD CONSTRAINT fk_projects_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE company_catalog
  ADD CONSTRAINT fk_company_catalog_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE job_fit_tags
  ADD CONSTRAINT fk_job_fit_tags_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE tech_stack_tags
  ADD CONSTRAINT fk_tech_stack_tags_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE quantified_bullets
  ADD CONSTRAINT fk_quantified_bullets_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE recurring_themes
  ADD CONSTRAINT fk_recurring_themes_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE catalog_change_log
  ADD CONSTRAINT fk_catalog_change_log_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE catalog_diffs
  ADD CONSTRAINT fk_catalog_diffs_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE wikilink_registry
  ADD CONSTRAINT fk_wikilink_registry_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE cover_letters
  ADD CONSTRAINT fk_cover_letters_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE outreach_messages
  ADD CONSTRAINT fk_outreach_messages_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE resume_variants
  ADD CONSTRAINT fk_resume_variants_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE interview_preps
  ADD CONSTRAINT fk_interview_preps_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE interview_prep_stories
  ADD CONSTRAINT fk_interview_prep_stories_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE prep_question_story_links
  ADD CONSTRAINT fk_prep_question_story_links_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 2: Enable Row-Level Security on all tables
-- ============================================================================

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_fit_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_stack_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE quantified_bullets ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wikilink_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE cover_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_preps ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_prep_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE prep_question_story_links ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 3: RLS Policies — each user only sees their own rows
-- ============================================================================

-- Applications
CREATE POLICY "applications_select_own" ON applications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "applications_insert_own" ON applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "applications_update_own" ON applications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "applications_delete_own" ON applications
  FOR DELETE USING (auth.uid() = user_id);

-- Status history
CREATE POLICY "status_history_select_own" ON status_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "status_history_insert_own" ON status_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "status_history_update_own" ON status_history
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "status_history_delete_own" ON status_history
  FOR DELETE USING (auth.uid() = user_id);

-- Resumes
CREATE POLICY "resumes_select_own" ON resumes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "resumes_insert_own" ON resumes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "resumes_update_own" ON resumes
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "resumes_delete_own" ON resumes
  FOR DELETE USING (auth.uid() = user_id);

-- Resume exports
CREATE POLICY "resume_exports_select_own" ON resume_exports
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "resume_exports_insert_own" ON resume_exports
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "resume_exports_update_own" ON resume_exports
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "resume_exports_delete_own" ON resume_exports
  FOR DELETE USING (auth.uid() = user_id);

-- Projects
CREATE POLICY "projects_select_own" ON projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "projects_insert_own" ON projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "projects_update_own" ON projects
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "projects_delete_own" ON projects
  FOR DELETE USING (auth.uid() = user_id);

-- Company catalog
CREATE POLICY "company_catalog_select_own" ON company_catalog
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "company_catalog_insert_own" ON company_catalog
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "company_catalog_update_own" ON company_catalog
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "company_catalog_delete_own" ON company_catalog
  FOR DELETE USING (auth.uid() = user_id);

-- Job fit tags
CREATE POLICY "job_fit_tags_select_own" ON job_fit_tags
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "job_fit_tags_insert_own" ON job_fit_tags
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "job_fit_tags_update_own" ON job_fit_tags
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "job_fit_tags_delete_own" ON job_fit_tags
  FOR DELETE USING (auth.uid() = user_id);

-- Tech stack tags
CREATE POLICY "tech_stack_tags_select_own" ON tech_stack_tags
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tech_stack_tags_insert_own" ON tech_stack_tags
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tech_stack_tags_update_own" ON tech_stack_tags
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "tech_stack_tags_delete_own" ON tech_stack_tags
  FOR DELETE USING (auth.uid() = user_id);

-- Quantified bullets
CREATE POLICY "quantified_bullets_select_own" ON quantified_bullets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "quantified_bullets_insert_own" ON quantified_bullets
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "quantified_bullets_update_own" ON quantified_bullets
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "quantified_bullets_delete_own" ON quantified_bullets
  FOR DELETE USING (auth.uid() = user_id);

-- Recurring themes
CREATE POLICY "recurring_themes_select_own" ON recurring_themes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "recurring_themes_insert_own" ON recurring_themes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recurring_themes_update_own" ON recurring_themes
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "recurring_themes_delete_own" ON recurring_themes
  FOR DELETE USING (auth.uid() = user_id);

-- Catalog change log
CREATE POLICY "catalog_change_log_select_own" ON catalog_change_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "catalog_change_log_insert_own" ON catalog_change_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Catalog diffs
CREATE POLICY "catalog_diffs_select_own" ON catalog_diffs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "catalog_diffs_insert_own" ON catalog_diffs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "catalog_diffs_update_own" ON catalog_diffs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "catalog_diffs_delete_own" ON catalog_diffs
  FOR DELETE USING (auth.uid() = user_id);

-- Wikilink registry
CREATE POLICY "wikilink_registry_select_own" ON wikilink_registry
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wikilink_registry_insert_own" ON wikilink_registry
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wikilink_registry_update_own" ON wikilink_registry
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "wikilink_registry_delete_own" ON wikilink_registry
  FOR DELETE USING (auth.uid() = user_id);

-- Cover letters
CREATE POLICY "cover_letters_select_own" ON cover_letters
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cover_letters_insert_own" ON cover_letters
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cover_letters_update_own" ON cover_letters
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cover_letters_delete_own" ON cover_letters
  FOR DELETE USING (auth.uid() = user_id);

-- Outreach messages
CREATE POLICY "outreach_messages_select_own" ON outreach_messages
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "outreach_messages_insert_own" ON outreach_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outreach_messages_update_own" ON outreach_messages
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "outreach_messages_delete_own" ON outreach_messages
  FOR DELETE USING (auth.uid() = user_id);

-- Resume variants
CREATE POLICY "resume_variants_select_own" ON resume_variants
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "resume_variants_insert_own" ON resume_variants
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "resume_variants_update_own" ON resume_variants
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "resume_variants_delete_own" ON resume_variants
  FOR DELETE USING (auth.uid() = user_id);

-- Interview preps
CREATE POLICY "interview_preps_select_own" ON interview_preps
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "interview_preps_insert_own" ON interview_preps
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "interview_preps_update_own" ON interview_preps
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "interview_preps_delete_own" ON interview_preps
  FOR DELETE USING (auth.uid() = user_id);

-- Interview prep stories
CREATE POLICY "interview_prep_stories_select_own" ON interview_prep_stories
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "interview_prep_stories_insert_own" ON interview_prep_stories
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "interview_prep_stories_update_own" ON interview_prep_stories
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "interview_prep_stories_delete_own" ON interview_prep_stories
  FOR DELETE USING (auth.uid() = user_id);

-- Prep question story links
CREATE POLICY "prep_question_story_links_select_own" ON prep_question_story_links
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "prep_question_story_links_insert_own" ON prep_question_story_links
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prep_question_story_links_update_own" ON prep_question_story_links
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "prep_question_story_links_delete_own" ON prep_question_story_links
  FOR DELETE USING (auth.uid() = user_id);
