// WIC-1963: regenerate `meta/_journal.json` from the `.sql` files on disk.
//
// The journal is a generated artifact (git-ignored), not a hand-edited, committed
// file — see `journal.ts` for why that is both safe and desirable. This CLI is the
// authoritative generator:
//
//   tsx src/db/generate-journal.ts            # write meta/_journal.json
//   tsx src/db/generate-journal.ts --check    # exit 1 if the file is missing or stale
//
// `db:migrate` also regenerates in-process (migrate.ts) so the deploy never
// depends on this having been run. `--check` exists for CI / local sanity.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { buildJournal, serializeJournal } from './journal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = join(__dirname, 'migrations');
export const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

/** List the `.sql` file names in the migrations directory. */
export function listSqlFileNames(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** Build the serialized journal text from the real migrations directory. */
export function renderJournal(dir: string = MIGRATIONS_DIR): string {
  return serializeJournal(buildJournal(listSqlFileNames(dir)));
}

function main(): void {
  const check = process.argv.includes('--check');
  const rendered = renderJournal();
  const where = relative(process.cwd(), JOURNAL_PATH);

  if (check) {
    if (!existsSync(JOURNAL_PATH)) {
      console.error(
        `Migration journal is missing (${where}). Run: npm run db:journal --workspace=@wic/api`
      );
      process.exit(1);
    }
    const current = readFileSync(JOURNAL_PATH, 'utf8');
    if (current !== rendered) {
      console.error(
        `Migration journal is stale (${where}). It is generated from the .sql files; ` +
          `run: npm run db:journal --workspace=@wic/api`
      );
      process.exit(1);
    }
    console.log(`Migration journal is up to date (${where}).`);
    return;
  }

  writeFileSync(JOURNAL_PATH, rendered);
  console.log(`Wrote ${where} (${buildJournal(listSqlFileNames()).entries.length} entries).`);
}

// Act as a CLI only when invoked directly, not when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
