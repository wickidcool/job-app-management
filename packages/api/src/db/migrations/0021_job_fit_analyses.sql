-- Migration: 0022_job_fit_analyses.sql
-- Create the `job_fit_analyses` table and turn the four `job_fit_analysis_id`
-- columns into real foreign keys (WIC-1652, ADR-012).
--
-- `docs/architecture/DATA_MODEL.md` has specified
-- `job_fit_analysis_id TEXT REFERENCES job_fit_analyses(id) ON DELETE SET NULL`
-- on `interview_preps` since UC-7 was written, and lists the
-- `interview_preps -> job_fit_analyses` relationship in its index -- but it never
-- defined the table, and the table was never built. The four referencing columns
-- shipped as bare `TEXT`, so every value in them points at nothing.
--
-- ORDER MATTERS. Every existing `job_fit_analysis_id` value is by construction
-- dangling (there has never been a row it could name), so the NULLing in STEP 2
-- must run BEFORE the constraints in STEP 3 or `ADD CONSTRAINT` fails on real
-- data. Do not reorder these steps.

-- ── STEP 1: the table ────────────────────────────────────────────────────────
--
-- `application_id` is NULLABLE on purpose. `POST /api/catalog/job-fit/analyze`
-- accepts a bare job description with no application context, and that flow is
-- reachable from the SPA today (`/job-fit-analysis` without an `appId`). A
-- NOT NULL column would reject those requests, which is a breaking change to a
-- shipped endpoint. Analyses that carry an application are the ones the
-- application workflow checklist reads.
--
-- `recommendation` and `fit_score` are NULLABLE together: `null` is a *result*
-- ("unscored" -- the catalog was empty, or the job description named no required
-- skills), not the absence of an analysis. See the UC-3 scoring algorithm in
-- `docs/architecture/API_CONTRACTS.md`.
--
-- `recommendation` is TEXT rather than an enum: it is a wire value that
-- `FitTier` is defined in terms of, and pinning it into a Postgres enum here
-- would make adding a member a two-place change with a migration in the middle.
-- The CHECK constraint gives the same integrity without that coupling.
CREATE TABLE IF NOT EXISTS job_fit_analyses (
  id                       TEXT PRIMARY KEY,
  user_id                  UUID,
  application_id           TEXT REFERENCES applications(id) ON DELETE CASCADE,
  job_description_text     TEXT,
  job_description_url      TEXT,
  recommendation           TEXT
                             CHECK (recommendation IS NULL OR recommendation IN
                               ('strong_fit', 'moderate_fit', 'stretch', 'low_fit')),
  fit_score                INTEGER
                             CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),
  summary                  TEXT NOT NULL,
  confidence               TEXT NOT NULL
                             CHECK (confidence IN ('high', 'medium', 'low')),
  parsed_jd                JSONB NOT NULL,
  strong_matches           JSONB NOT NULL DEFAULT '[]',
  partial_matches          JSONB NOT NULL DEFAULT '[]',
  gaps                     JSONB NOT NULL DEFAULT '[]',
  recommended_star_entries JSONB NOT NULL DEFAULT '[]',
  catalog_empty            BOOLEAN NOT NULL DEFAULT FALSE,
  analyzed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The checklist read is "the newest analysis for this application, owned by this
-- caller", so the index leads with both scoping columns.
CREATE INDEX IF NOT EXISTS idx_job_fit_analyses_user_application
  ON job_fit_analyses(user_id, application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_fit_analyses_application
  ON job_fit_analyses(application_id);

-- FK to auth.users, matching every other user-scoped table
-- (0016_personal_info_rls.sql, 0019_onboarding_status_rls.sql). Guarded so the
-- migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_job_fit_analyses_user_id'
      AND table_name = 'job_fit_analyses'
  ) THEN
    ALTER TABLE job_fit_analyses
      ADD CONSTRAINT fk_job_fit_analyses_user_id
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END$$;

-- RLS. The Worker reaches Postgres over the owner role (Hyperdrive in preview,
-- the transaction pooler in production), which bypasses RLS, so this does not
-- change the app's own queries -- it closes the auto-generated PostgREST/anon-key
-- surface, matching every other user-scoped table.
ALTER TABLE job_fit_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_fit_analyses_isolation ON job_fit_analyses;

CREATE POLICY job_fit_analyses_isolation ON job_fit_analyses
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── STEP 2: null the dangling referrers ──────────────────────────────────────
--
-- Must precede STEP 3. Every non-NULL value in these columns names an analysis
-- that has never existed -- the column was written from a request field that was
-- accepted without validation (WIC-1818) -- so each one would violate the
-- constraint about to be added. There is nothing to preserve: the value was
-- never dereferenceable, and `ON DELETE SET NULL` is what the schema says these
-- columns do when their referent goes away.
UPDATE cover_letters      SET job_fit_analysis_id = NULL WHERE job_fit_analysis_id IS NOT NULL;
UPDATE resume_variants    SET job_fit_analysis_id = NULL WHERE job_fit_analysis_id IS NOT NULL;
UPDATE outreach_messages  SET job_fit_analysis_id = NULL WHERE job_fit_analysis_id IS NOT NULL;
UPDATE interview_preps    SET job_fit_analysis_id = NULL WHERE job_fit_analysis_id IS NOT NULL;

-- ── STEP 3: the constraints DATA_MODEL.md always specified ───────────────────
DO $$
DECLARE
  t TEXT;
  c TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cover_letters', 'resume_variants', 'outreach_messages', 'interview_preps']
  LOOP
    c := 'fk_' || t || '_job_fit_analysis_id';
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = c AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (job_fit_analysis_id) '
        || 'REFERENCES job_fit_analyses(id) ON DELETE SET NULL',
        t, c
      );
    END IF;
  END LOOP;
END$$;
