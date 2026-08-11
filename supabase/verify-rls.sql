-- WIC-905: Read-only RLS status report for the jobtrail prod project (fnmuv).
-- Paste into Supabase dashboard → SQL Editor, or run via psql, to confirm every
-- user-scoped table has RLS enabled, own-row policies, and NO anon table access.
-- Any row with rls_enabled = false, policy_count < 4, or anon_can_select = true
-- is a leak risk once the publishable/anon key is public (WIC-902).
WITH expected(tbl) AS (
  VALUES ('applications'),('status_history'),('resumes'),('resume_exports'),
         ('resume_variants'),('cover_letters'),('outreach_messages'),
         ('catalog_change_log'),('catalog_diffs'),('wikilink_registry'),
         ('quantified_bullets'),('interview_preps'),('interview_prep_stories'),
         ('prep_question_story_links'),('personal_info'),('onboarding_status')
)
SELECT e.tbl AS table,
       (c.oid IS NOT NULL)                                            AS table_exists,
       COALESCE(c.relrowsecurity, false)                              AS rls_enabled,
       COALESCE((SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid), 0) AS policy_count,
       CASE WHEN c.oid IS NULL THEN NULL
            ELSE has_table_privilege('anon', c.oid, 'SELECT') END     AS anon_can_select
FROM expected e
LEFT JOIN pg_class c
  ON c.relname = e.tbl
 AND c.relnamespace = 'public'::regnamespace
 AND c.relkind = 'r'
ORDER BY e.tbl;
