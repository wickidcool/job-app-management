# Cloud Migration Schema Changes

This document details the database schema changes required for multi-tenancy support in the cloud migration.

## Overview

All user-owned data tables require a `user_id` column that references `auth.users(id)` from Supabase Auth. Row-Level Security (RLS) policies enforce user isolation at the database level.

## Migration Strategy

### Phase 1: Add user_id Columns

The migration adds `user_id` as a required column to all data tables. For existing local data, a migration script assigns all records to the first authenticated user.

### Migration File

```sql
-- Migration: 0010_add_user_id_multi_tenancy.sql

-- Enable UUID extension if not present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- STEP 1: Add user_id columns (nullable initially for migration)
-- ============================================================================

ALTER TABLE applications 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE status_history 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE resumes 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE resume_exports 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE projects 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE company_catalog 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE job_fit_tags 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE tech_stack_tags 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE quantified_bullets 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE recurring_themes 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE catalog_change_log 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE catalog_diffs 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE wikilink_registry 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE cover_letters 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE outreach_messages 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE resume_variants 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE interview_preps 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE interview_prep_stories 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE prep_question_story_links 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 2: Create indexes for user_id queries
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

-- ============================================================================
-- STEP 3: Enable Row-Level Security
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
-- STEP 4: Create RLS Policies
-- ============================================================================

-- Applications policies
CREATE POLICY "applications_select_own" ON applications 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "applications_insert_own" ON applications 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "applications_update_own" ON applications 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "applications_delete_own" ON applications 
  FOR DELETE USING (auth.uid() = user_id);

-- Status history policies
CREATE POLICY "status_history_select_own" ON status_history 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "status_history_insert_own" ON status_history 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "status_history_update_own" ON status_history 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "status_history_delete_own" ON status_history 
  FOR DELETE USING (auth.uid() = user_id);

-- Resumes policies
CREATE POLICY "resumes_select_own" ON resumes 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "resumes_insert_own" ON resumes 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "resumes_update_own" ON resumes 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "resumes_delete_own" ON resumes 
  FOR DELETE USING (auth.uid() = user_id);

-- Resume exports policies
CREATE POLICY "resume_exports_select_own" ON resume_exports 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "resume_exports_insert_own" ON resume_exports 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "resume_exports_update_own" ON resume_exports 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "resume_exports_delete_own" ON resume_exports 
  FOR DELETE USING (auth.uid() = user_id);

-- Projects policies
CREATE POLICY "projects_select_own" ON projects 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "projects_insert_own" ON projects 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "projects_update_own" ON projects 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "projects_delete_own" ON projects 
  FOR DELETE USING (auth.uid() = user_id);

-- Company catalog policies
CREATE POLICY "company_catalog_select_own" ON company_catalog 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "company_catalog_insert_own" ON company_catalog 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "company_catalog_update_own" ON company_catalog 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "company_catalog_delete_own" ON company_catalog 
  FOR DELETE USING (auth.uid() = user_id);

-- Job fit tags policies
CREATE POLICY "job_fit_tags_select_own" ON job_fit_tags 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "job_fit_tags_insert_own" ON job_fit_tags 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "job_fit_tags_update_own" ON job_fit_tags 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "job_fit_tags_delete_own" ON job_fit_tags 
  FOR DELETE USING (auth.uid() = user_id);

-- Tech stack tags policies
CREATE POLICY "tech_stack_tags_select_own" ON tech_stack_tags 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tech_stack_tags_insert_own" ON tech_stack_tags 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tech_stack_tags_update_own" ON tech_stack_tags 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "tech_stack_tags_delete_own" ON tech_stack_tags 
  FOR DELETE USING (auth.uid() = user_id);

-- Quantified bullets policies
CREATE POLICY "quantified_bullets_select_own" ON quantified_bullets 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "quantified_bullets_insert_own" ON quantified_bullets 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "quantified_bullets_update_own" ON quantified_bullets 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "quantified_bullets_delete_own" ON quantified_bullets 
  FOR DELETE USING (auth.uid() = user_id);

-- Recurring themes policies
CREATE POLICY "recurring_themes_select_own" ON recurring_themes 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "recurring_themes_insert_own" ON recurring_themes 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recurring_themes_update_own" ON recurring_themes 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "recurring_themes_delete_own" ON recurring_themes 
  FOR DELETE USING (auth.uid() = user_id);

-- Catalog change log policies
CREATE POLICY "catalog_change_log_select_own" ON catalog_change_log 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "catalog_change_log_insert_own" ON catalog_change_log 
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Catalog diffs policies
CREATE POLICY "catalog_diffs_select_own" ON catalog_diffs 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "catalog_diffs_insert_own" ON catalog_diffs 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "catalog_diffs_update_own" ON catalog_diffs 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "catalog_diffs_delete_own" ON catalog_diffs 
  FOR DELETE USING (auth.uid() = user_id);

-- Wikilink registry policies
CREATE POLICY "wikilink_registry_select_own" ON wikilink_registry 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wikilink_registry_insert_own" ON wikilink_registry 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wikilink_registry_update_own" ON wikilink_registry 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "wikilink_registry_delete_own" ON wikilink_registry 
  FOR DELETE USING (auth.uid() = user_id);

-- Cover letters policies
CREATE POLICY "cover_letters_select_own" ON cover_letters 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cover_letters_insert_own" ON cover_letters 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cover_letters_update_own" ON cover_letters 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cover_letters_delete_own" ON cover_letters 
  FOR DELETE USING (auth.uid() = user_id);

-- Outreach messages policies
CREATE POLICY "outreach_messages_select_own" ON outreach_messages 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "outreach_messages_insert_own" ON outreach_messages 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outreach_messages_update_own" ON outreach_messages 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "outreach_messages_delete_own" ON outreach_messages 
  FOR DELETE USING (auth.uid() = user_id);

-- Resume variants policies
CREATE POLICY "resume_variants_select_own" ON resume_variants 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "resume_variants_insert_own" ON resume_variants 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "resume_variants_update_own" ON resume_variants 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "resume_variants_delete_own" ON resume_variants 
  FOR DELETE USING (auth.uid() = user_id);

-- Interview preps policies
CREATE POLICY "interview_preps_select_own" ON interview_preps 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "interview_preps_insert_own" ON interview_preps 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "interview_preps_update_own" ON interview_preps 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "interview_preps_delete_own" ON interview_preps 
  FOR DELETE USING (auth.uid() = user_id);

-- Interview prep stories policies
CREATE POLICY "interview_prep_stories_select_own" ON interview_prep_stories 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "interview_prep_stories_insert_own" ON interview_prep_stories 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "interview_prep_stories_update_own" ON interview_prep_stories 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "interview_prep_stories_delete_own" ON interview_prep_stories 
  FOR DELETE USING (auth.uid() = user_id);

-- Prep question story links policies
CREATE POLICY "prep_question_story_links_select_own" ON prep_question_story_links 
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "prep_question_story_links_insert_own" ON prep_question_story_links 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prep_question_story_links_update_own" ON prep_question_story_links 
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "prep_question_story_links_delete_own" ON prep_question_story_links 
  FOR DELETE USING (auth.uid() = user_id);
```

## Drizzle Schema Updates

Update `packages/api/src/db/schema.ts` to include `userId` on all tables:

```typescript
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

// Reference to Supabase auth.users table (not managed by Drizzle)
// We only need the UUID reference for foreign keys

export const applications = pgTable('applications', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(), // Add to all tables
  jobTitle: text('job_title').notNull(),
  company: text('company').notNull(),
  // ... rest of columns
});

// Similar updates for all other tables
```

## API Changes

All queries must be scoped by `userId`:

```typescript
// Before (single-user)
const apps = await db.select().from(applications);

// After (multi-tenant)
const apps = await db
  .select()
  .from(applications)
  .where(eq(applications.userId, userId));
```

All inserts must include `userId`:

```typescript
// Before
await db.insert(applications).values({ id, jobTitle, company });

// After
await db.insert(applications).values({ id, userId, jobTitle, company });
```

## File Storage Path Changes

Local filesystem paths change to include user ID:

```
# Before
./data/resumes/{resume_id}.pdf

# After (local)
./data/{user_id}/resumes/{resume_id}.pdf

# After (R2)
jobapp-files/{user_id}/resumes/{resume_id}.pdf
```

## Migration Checklist

- [ ] Add `user_id` column to all tables
- [ ] Create indexes for `user_id` queries
- [ ] Enable RLS on all tables
- [ ] Create RLS policies for each table
- [ ] Update Drizzle schema with `userId` field
- [ ] Update all service methods to filter by `userId`
- [ ] Update all insert operations to include `userId`
- [ ] Update file paths to include user ID prefix
- [ ] Test with Supabase local CLI
- [ ] Deploy migrations to Supabase production
