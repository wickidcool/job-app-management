// WIC-1408 — print the population migration 0020 would act on. Read-only.
//
// The card gates the backfill on a count ("do not write a migration for zero
// rows"), and that count can only be taken against a real database with a real
// DATABASE_URL — which no agent here has. So the count lives in this script,
// runnable by whoever holds the credential, rather than in a claim about a
// number nobody measured.
//
//   DATABASE_URL=... npm run census:catalog-diffs --workspace=@wic/api
//
// Exits 0 whether or not there is anything to recover; a zero population is an
// answer, not a failure. Exits 1 only if the query itself fails.
import postgres from 'postgres';
import {
  ORPHAN_CENSUS_SQL,
  PLACEHOLDER_CENSUS_SQL,
  summarise,
} from './lib/catalog-diff-owner-census.mjs';

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) {
  console.error('Error: DATABASE_URL is not set.');
  process.exit(1);
}

const isSupabase =
  databaseUrl.includes('supabase.co') || databaseUrl.includes('pooler.supabase.com');

async function main() {
  try {
    const u = new URL(databaseUrl);
    u.password = '***';
    console.log(`Census target: ${u.toString()}\n`);
  } catch {
    console.log('Census target: (could not parse DATABASE_URL)\n');
  }

  const sql = postgres(databaseUrl, { max: 1, ssl: isSupabase ? 'require' : false, prepare: false });
  try {
    const [census] = await sql.unsafe(ORPHAN_CENSUS_SQL);
    const [placeholder] = await sql.unsafe(PLACEHOLDER_CENSUS_SQL);
    const { text } = summarise(census, placeholder);
    console.log(text);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Census failed:', err);
  process.exit(1);
});
