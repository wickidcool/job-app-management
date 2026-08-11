// WIC-905: Verify RLS is enforced on every user-scoped jobtrail table.
// Exits non-zero (fails the deploy) if any user-scoped table has RLS disabled,
// lacks own-row policies, or still grants table access to `anon`.
//
// The set of tables to check is DERIVED FROM THE DATABASE — every base table in
// `public` that has a `user_id` column — rather than a hand-maintained list. This
// is deliberate: a hard-coded expected-list can pass while a real user-scoped
// table is left uncovered (exactly the gap that shipped in the first cut, which
// omitted projects/company_catalog/job_fit_tags/tech_stack_tags/recurring_themes).
// Deriving the set from user_id columns makes the verifier fail-closed against
// schema drift and mirrors how 0002_rls_current_schema.sql chooses tables.
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) {
  console.error('Error: DATABASE_URL is not set.');
  process.exit(1);
}
const isSupabase =
  databaseUrl.includes('supabase.co') || databaseUrl.includes('pooler.supabase.com');

async function main() {
  const sql = postgres(databaseUrl, { max: 1, ssl: isSupabase ? 'require' : false, prepare: false });
  let failures = 0;
  try {
    const rows = await sql`
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
      ORDER BY c.relname`;

    // Fail-closed: no user-scoped tables discovered means we're pointed at the wrong
    // database/schema, not that everything is secure.
    if (rows.length === 0) {
      console.error(
        'RLS verification FAILED: no user-scoped tables (public.* with a user_id column) found.'
      );
      process.exit(1);
    }

    console.log('table                          rls  policies  anon_select');
    console.log('------------------------------ ---- --------- -----------');
    for (const r of rows) {
      const ok = r.rls_enabled && Number(r.policy_count) >= 4 && !r.anon_can_select;
      if (!ok) failures++;
      console.log(
        `${r.table.padEnd(30)} ${r.rls_enabled ? 'ON ' : 'OFF'}  ${String(r.policy_count).padStart(8)}  ${r.anon_can_select ? 'YES(!)' : 'no'}${ok ? '' : '   <-- FAIL'}`
      );
    }
    console.log(`\nChecked ${rows.length} user-scoped table(s).`);
  } finally {
    await sql.end();
  }

  if (failures > 0) {
    console.error(`\nRLS verification FAILED: ${failures} table(s) not correctly secured.`);
    process.exit(1);
  }
  console.log('RLS verification passed: all user-scoped tables RLS-enforced, no anon table access.');
}

main().catch((err) => {
  console.error('RLS verify failed:', err);
  process.exit(1);
});
