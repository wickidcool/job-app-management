-- Migration: 0026_application_interview_date.sql
-- Back `applications.interview_date` in the database (WIC-2023).
--
-- The web app has consumed `interviewDate` since UC-8 shipped:
-- `packages/web/src/types/interviewPrep.ts` declares it on `ApplicationSummary`,
-- `InterviewPrepCard.tsx:138` gates a countdown on it and
-- `QuickReferenceExport.tsx:111` prints it into the exported quick reference.
-- Nothing has ever backed it -- there is no column, and no endpoint sends the
-- field -- so both render sites take the empty branch unconditionally. The repo
-- already knew: `interviewPrep.drift.test.ts` baselined the field in
-- `KNOWN_UNBACKED_FIELDS`. This migration is the server half that lets that
-- baseline come off.
--
-- TIMESTAMPTZ, not DATE. Two reasons, and both are load-bearing downstream:
--
--   1. The consumers already treat it as an instant. `InterviewPrepCard.tsx:28`
--      does `new Date(application.interviewDate)` and formats a time from it. A
--      `DATE` column would round-trip as `YYYY-MM-DD`, which that constructor
--      parses as UTC midnight -- rendering "7:00 PM the previous day" for any
--      user west of Greenwich. An interview is a point in time, not a day.
--   2. WIC-1798 ("Interviews This Week") needs an orderable instant to build a
--      half-open time window over. `nextActionDue` is `DATE` and is the right
--      type for a due date, but it is the wrong sibling to copy here.
--
-- NULLABLE, no DEFAULT, no backfill. Every existing row genuinely has no known
-- interview date, and `NULL` is the honest encoding of that. A default would
-- manufacture data. This is additive-only: no existing read path selects the
-- column, and no write path sets it, so the migration is safe to apply ahead of
-- the code that uses it.
--
-- RLS: no policy change is required, and this was checked rather than assumed.
-- `supabase/migrations/0001_rls_user_isolation.sql:126-133` defines all four
-- `applications` policies as row-level predicates over `user_id`
-- (`auth.uid() = user_id`) with no column lists, and
-- `0002_rls_current_schema.sql:78` grants at table granularity
-- (`GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I`). There are no
-- column-level grants anywhere in the tree, so a new column inherits the
-- existing row-level protection automatically.
--
-- `IF NOT EXISTS` keeps this idempotent under drizzle's journal-driven
-- migrator, consistent with 0018/0022 in this directory.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS interview_date TIMESTAMPTZ;

COMMENT ON COLUMN applications.interview_date IS
  'Scheduled interview instant. Nullable: NULL means no interview is scheduled. TIMESTAMPTZ because the UI formats a time-of-day from it and "Interviews This Week" windows on it (WIC-2023).';
