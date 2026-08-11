-- WIC-905: Idempotent, schema-accurate Row-Level Security for jobtrail.
-- Supersedes 0001_rls_user_isolation.sql (which enumerated tables by hand, missed
-- personal_info + onboarding_status, and never revoked anon table grants).
--
-- Coverage is DERIVED DYNAMICALLY: every base table in `public` that has a
-- `user_id` column is user-scoped and gets RLS + own-row policies + anon revoke.
-- This is fail-closed by construction — a newly added user-scoped table is picked
-- up automatically, so the set can never silently drift below the real schema
-- (the failure mode that shipped in the first cut of this migration, which
-- hard-coded 16 tables and omitted projects, company_catalog, job_fit_tags,
-- tech_stack_tags, recurring_themes). The verifier (scripts/verify-rls.mjs)
-- derives the same set independently and fails the deploy on any gap.
--
-- Why this exists (WIC-902 context): prod GitHub var SUPABASE_ANON_KEY was swapped
-- from an RLS-bypassing sb_secret_ (service_role) key to a browser-safe
-- sb_publishable_ (anon) key. The jobtrail SERVER (Cloudflare Worker) reaches
-- Postgres via DATABASE_URL as the `postgres` owner role, so it BYPASSES RLS and is
-- unaffected by the swap. RLS matters as defense-in-depth: now that a publishable
-- key can be reachable, any direct PostgREST call (/rest/v1/<table>) must NOT leak
-- data. This migration guarantees that.
--
-- Safe to run repeatedly. Requires the Supabase-managed auth schema (auth.uid());
-- a no-op-ish failure on plain local Postgres is expected there.
--
-- Applied by: packages/api/scripts/apply-rls.mjs (npm run db:rls --workspace=@wic/api),
-- invoked from the deploy workflow's "Run database migrations" step.

DO $$
DECLARE
  t text;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'user_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
    ORDER BY c.relname
  LOOP
    n := n + 1;

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

    RAISE NOTICE 'RLS: secured public.%', t;
  END LOOP;

  -- Fail-closed guard: a healthy jobtrail schema has many user-scoped tables. If we
  -- found none, discovery is broken (wrong DB / schema) — do not report silent success.
  IF n = 0 THEN
    RAISE EXCEPTION 'RLS: no user-scoped tables (public.* with a user_id column) found — refusing to report success';
  END IF;

  RAISE NOTICE 'RLS: secured % user-scoped table(s)', n;
END $$;
