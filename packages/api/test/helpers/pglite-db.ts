import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/**
 * Supabase-managed objects that live outside our migrations. `0016` and `0019`
 * both reference `auth.users` and `auth.uid()`, which exist in a real Supabase
 * project and in no plain Postgres. Stub them so the *real* migration files can
 * be replayed verbatim — the point of this helper is that nothing is
 * hand-transcribed. `auth.uid()` returns NULL, which is correct here: these
 * tests speak to the database as the service role, not through RLS.
 */
const SUPABASE_PRELUDE = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
`;

/**
 * An in-process Postgres with the project's real migrations applied.
 *
 * Migrations are applied **in `meta/_journal.json` order, by tag** rather than
 * by globbing the directory, because that is exactly what drizzle's migrator
 * does at deploy time. A `.sql` file added without its journal entry is a
 * migration that never runs in production, and this helper reproduces that
 * failure instead of hiding it: the column simply will not exist and every
 * assertion below fails loudly. Hand-written DDL was tried first on WIC-1617
 * and produced a clean false negative by omitting a column the real file adds.
 */
export async function createMigratedDb() {
  const client = new PGlite();
  await client.exec(SUPABASE_PRELUDE);

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')
  ) as { entries: { tag: string }[] };

  for (const entry of journal.entries) {
    const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    try {
      await client.exec(sql);
    } catch (err) {
      throw new Error(`migration ${entry.tag} failed: ${String(err)}`);
    }
  }

  return { client, db: drizzle(client) };
}
