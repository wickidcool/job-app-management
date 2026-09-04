import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildJournal, serializeJournal } from './journal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migrationsFolder = join(__dirname, 'migrations');

// WIC-1963: `meta/_journal.json` is generated, not committed. Regenerate it from
// the `.sql` files on disk immediately before applying, so the deploy's migrate
// step is self-contained and can never run against a stale, conflicted, or
// entry-dropped journal. `buildJournal` reproduces every historical `when`
// exactly (see journal.ts), so the applied/skip watermark is unchanged; it
// throws on a same-number collision rather than silently dropping a migration.
function regenerateJournal(): void {
  const sqlFileNames = readdirSync(migrationsFolder).filter((name) => name.endsWith('.sql'));
  const journal = buildJournal(sqlFileNames);
  writeFileSync(join(migrationsFolder, 'meta', '_journal.json'), serializeJournal(journal));
  console.log(`Regenerated migration journal: ${journal.entries.length} entries.`);
}

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) {
  console.error('Error: DATABASE_URL environment variable is not set.');
  console.error(
    'Example: DATABASE_URL="postgresql://postgres.PROJECT:PASSWORD@aws-X.pooler.supabase.com:5432/postgres"'
  );
  process.exit(1);
}

// Supabase requires SSL and disallows prepared statements on the transaction pooler.
const isSupabase =
  databaseUrl.includes('supabase.co') || databaseUrl.includes('pooler.supabase.com');

async function runMigrations() {
  // Log the target host (no password) so it's obvious which database is being migrated.
  try {
    const u = new URL(databaseUrl);
    u.password = '***';
    console.log(`Target database: ${u.toString()}`);
  } catch {
    console.log('Target database: (could not parse DATABASE_URL)');
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: isSupabase ? 'require' : false,
    prepare: false,
  });
  const db = drizzle(sql);

  regenerateJournal();

  console.log('Running migrations...');
  await migrate(db, { migrationsFolder });
  console.log('Migrations complete.');

  await sql.end();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
