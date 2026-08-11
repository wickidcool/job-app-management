-- WIC-905: Idempotent, schema-accurate Row-Level Security for jobtrail.
-- Supersedes 0001_rls_user_isolation.sql (which is STALE: it references dropped
-- tables — projects, company_catalog, job_fit_tags, tech_stack_tags,
-- recurring_themes — and MISSES current tables personal_info + onboarding_status).
--
-- Why this exists (WIC-902 context): prod GitHub var SUPABASE_ANON_KEY was swapped
-- from an RLS-bypassing sb_secret_ (service_role) key to a browser-safe
-- sb_publishable_ (anon) key. The jobtrail SERVER (Cloudflare Worker) reaches
-- Postgres via DATABASE_URL as the `postgres` owner role, so it BYPASSES RLS and is
-- unaffected by the swap. RLS matters as defense-in-depth: now that a publishable
-- key can be reachable, any direct PostgREST call (/rest/v1/<table>) must NOT leak
-- data. This migration guarantees that.
--
-- Safe to run repeatedly. Existence-guarded (skips tables not present) so it never
-- errors on a schema that has drifted. Requires the Supabase-managed auth schema
-- (auth.uid()); a no-op-ish failure on plain local Postgres is expected there.
--
-- Applied by: packages/api/scripts/apply-rls.mjs (npm run db:rls --workspace=@wic/api),
-- invoked from the deploy workflow's "Run database migrations" step.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'applications',
    'status_history',
    'resumes',
    'resume_exports',
    'resume_variants',
    'cover_letters',
    'outreach_messages',
    'catalog_change_log',
    'catalog_diffs',
    'wikilink_registry',
    'quantified_bullets',
    'interview_preps',
    'interview_prep_stories',
    'prep_question_story_links',
    'personal_info',
    'onboarding_status'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip tables that don't exist in this database (schema drift / partial deploys).
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'RLS: skipping missing table %', t;
      CONTINUE;
    END IF;

    -- 1. Enable RLS (idempotent — no error if already enabled).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 2. Own-row policies scoped to the authenticated role. Drop-then-create so
    --    re-running always converges to the correct definition.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_own', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)',
      t || '_select_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)',
      t || '_insert_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
      t || '_update_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)',
      t || '_delete_own', t);

    -- 3. Grants. The app never touches these tables as anon (anon is used only for
    --    GoTrue auth), so revoke all anon table access — a publishable/anon key then
    --    gets a hard permission-denied at PostgREST, not just RLS-filtered rows.
    --    authenticated keeps CRUD, but RLS still limits it to the caller's own rows.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
