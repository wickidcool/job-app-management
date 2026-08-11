-- WIC-905: Read-only RLS status report for the jobtrail prod project (fnmuv).
-- Paste into Supabase dashboard → SQL Editor, or run via psql, to confirm every
-- user-scoped table has RLS enabled, own-row policies, and NO anon table access.
--
-- The table set is DERIVED FROM THE SCHEMA — every base table in `public` with a
-- `user_id` column — so it can never fall behind the real schema (mirrors both
-- 0002_rls_current_schema.sql and scripts/verify-rls.mjs). Any row with
-- rls_enabled = false, policy_count < 4, or anon_can_select = true is a leak risk
-- once the publishable/anon key is public (WIC-902).
SELECT c.relname AS table,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = c.oid
      AND a.attname = 'user_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
ORDER BY c.relname;
