// WIC-905: Apply the idempotent RLS migration to the target database.
// Runs supabase/migrations/0002_rls_current_schema.sql via a direct Postgres
// connection (DATABASE_URL). The drizzle migrator (db:migrate) only processes
// packages/api/src/db/migrations, so the Supabase-specific RLS SQL needs this
// dedicated runner. Safe to run repeatedly — the SQL is idempotent.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rlsFile = join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0002_rls_current_schema.sql');

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
    console.log(`Applying RLS to: ${u.toString()}`);
  } catch {
    console.log('Applying RLS to: (could not parse DATABASE_URL)');
  }

  const sqlText = readFileSync(rlsFile, 'utf8');
  const sql = postgres(databaseUrl, { max: 1, ssl: isSupabase ? 'require' : false, prepare: false });
  try {
    await sql.unsafe(sqlText);
    console.log('RLS migration applied successfully.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('RLS apply failed:', err);
  process.exit(1);
});
