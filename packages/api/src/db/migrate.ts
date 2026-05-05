import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  const sql = postgres(databaseUrl, { max: 1, ssl: isSupabase ? 'require' : false, prepare: false });
  const db = drizzle(sql);

  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
  console.log('Migrations complete.');

  await sql.end();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
