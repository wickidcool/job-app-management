-- Migration: 0017_enforce_userid_not_null.sql
-- Enforces tenant isolation: make user_id NOT NULL on user-owned tables,
-- replace global unique constraints with per-user composite unique constraints,
-- and add composite indexes for efficient per-tenant queries.

-- ============================================================================
-- STEP 1: Backfill NULL user_id values with a placeholder UUID so NOT NULL
--         constraints can be applied. Records with this UUID should be
--         treated as orphaned/legacy data.
-- ============================================================================

DO $$
DECLARE
  placeholder UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  UPDATE projects        SET user_id = placeholder WHERE user_id IS NULL;
  UPDATE company_catalog SET user_id = placeholder WHERE user_id IS NULL;
  UPDATE job_fit_tags    SET user_id = placeholder WHERE user_id IS NULL;
  UPDATE tech_stack_tags SET user_id = placeholder WHERE user_id IS NULL;
  UPDATE quantified_bullets SET user_id = placeholder WHERE user_id IS NULL;
  UPDATE recurring_themes   SET user_id = placeholder WHERE user_id IS NULL;
  UPDATE catalog_diffs      SET user_id = placeholder WHERE user_id IS NULL;
END $$;

-- ============================================================================
-- STEP 2: Add NOT NULL constraints
-- ============================================================================

ALTER TABLE projects          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE company_catalog   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE job_fit_tags      ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE tech_stack_tags   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE quantified_bullets ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE recurring_themes  ALTER COLUMN user_id SET NOT NULL;

-- ============================================================================
-- STEP 3: Replace global unique constraints with per-user composite unique
--         constraints. This allows multiple users to have records with the
--         same slug/normalized_name without conflicting.
-- ============================================================================

-- Drop old global unique constraints (try both PostgreSQL inline-UNIQUE naming
-- convention "{table}_{col}_key" and Drizzle's "{table}_{col}_unique").

-- projects.slug
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_slug_key;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_slug_unique;

-- company_catalog.normalized_name
ALTER TABLE company_catalog DROP CONSTRAINT IF EXISTS company_catalog_normalized_name_key;
ALTER TABLE company_catalog DROP CONSTRAINT IF EXISTS company_catalog_normalized_name_unique;

-- job_fit_tags.tag_slug
ALTER TABLE job_fit_tags DROP CONSTRAINT IF EXISTS job_fit_tags_tag_slug_key;
ALTER TABLE job_fit_tags DROP CONSTRAINT IF EXISTS job_fit_tags_tag_slug_unique;

-- tech_stack_tags.tag_slug
ALTER TABLE tech_stack_tags DROP CONSTRAINT IF EXISTS tech_stack_tags_tag_slug_key;
ALTER TABLE tech_stack_tags DROP CONSTRAINT IF EXISTS tech_stack_tags_tag_slug_unique;

-- recurring_themes.theme_slug
ALTER TABLE recurring_themes DROP CONSTRAINT IF EXISTS recurring_themes_theme_slug_key;
ALTER TABLE recurring_themes DROP CONSTRAINT IF EXISTS recurring_themes_theme_slug_unique;

-- ============================================================================
-- STEP 4: Add per-user composite unique indexes (enforces uniqueness within
--         each user's data, not globally).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_slug
  ON projects(user_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_catalog_user_normalized
  ON company_catalog(user_id, normalized_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_fit_tags_user_slug
  ON job_fit_tags(user_id, tag_slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_stack_tags_user_slug
  ON tech_stack_tags(user_id, tag_slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_themes_user_slug
  ON recurring_themes(user_id, theme_slug);

-- ============================================================================
-- STEP 5: Add composite indexes for efficient per-tenant list queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_projects_user_updated
  ON projects(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_catalog_user_deleted
  ON company_catalog(user_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_job_fit_tags_user_category
  ON job_fit_tags(user_id, category);

CREATE INDEX IF NOT EXISTS idx_tech_stack_tags_user_category
  ON tech_stack_tags(user_id, category);

CREATE INDEX IF NOT EXISTS idx_recurring_themes_user_is_core
  ON recurring_themes(user_id, is_core_strength);

CREATE INDEX IF NOT EXISTS idx_quantified_bullets_user_source
  ON quantified_bullets(user_id, source_type, source_id);
