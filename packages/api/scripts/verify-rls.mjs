// WIC-905: Verify RLS is enforced on every user-scoped jobtrail table.
// Exits non-zero (fails the deploy) if any expected table is missing, has RLS
// disabled, lacks own-row policies, or still grants table access to `anon`.
import postgres from 'postgres';

const EXPECTED = [
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
  'onboarding_status',
];

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
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname = ANY(${EXPECTED})
      ORDER BY c.relname`;

    const found = new Map(rows.map((r) => [r.table, r]));
    console.log('table                          rls  policies  anon_select');
    console.log('------------------------------ ---- --------- -----------');
    for (const t of EXPECTED) {
      const r = found.get(t);
      if (!r) {
        console.log(`${t.padEnd(30)} MISSING`);
        failures++;
        continue;
      }
      const ok = r.rls_enabled && Number(r.policy_count) >= 4 && !r.anon_can_select;
      if (!ok) failures++;
      console.log(
        `${t.padEnd(30)} ${r.rls_enabled ? 'ON ' : 'OFF'}  ${String(r.policy_count).padStart(8)}  ${r.anon_can_select ? 'YES(!)' : 'no'}${ok ? '' : '   <-- FAIL'}`
      );
    }
  } finally {
    await sql.end();
  }

  if (failures > 0) {
    console.error(`\nRLS verification FAILED: ${failures} table(s) not correctly secured.`);
    process.exit(1);
  }
  console.log('\nRLS verification passed: all tables RLS-enforced, no anon table access.');
}

main().catch((err) => {
  console.error('RLS verify failed:', err);
  process.exit(1);
});
