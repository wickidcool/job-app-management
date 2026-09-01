#!/usr/bin/env node
// WIC-1939: fail the build when `meta/_journal.json` and the migrations
// directory disagree. See `migration-journal-guard.mjs` for the mechanism and
// the incident that motivated it.
//
// Run: node packages/api/scripts/audit-migration-journal.mjs
// Exits 1 on any violation. Also runs inside the api vitest suite
// (test/migration-journal.guard.test.ts), which additionally proves each check
// fires by mutating a synthetic tree.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { auditMigrationJournal } from './migration-journal-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');
export const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

/** Read the real tree and audit it. Exported so the vitest suite runs the same code path CI does. */
export function auditRealMigrationTree() {
  const journalText = readFileSync(JOURNAL_PATH, 'utf8');
  const sqlFileNames = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return auditMigrationJournal({ journalText, sqlFileNames });
}

// Only act as a CLI when invoked directly, not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = auditRealMigrationTree();
  const where = relative(process.cwd(), MIGRATIONS_DIR);
  if (violations.length === 0) {
    console.log(`Migration journal audit: OK (${where})`);
    process.exit(0);
  }
  console.error(`Migration journal audit FAILED — ${violations.length} violation(s) in ${where}:\n`);
  for (const v of violations) {
    console.error(`  [${v.check}] ${v.message}`);
  }
  console.error(
    '\ndrizzle migrate() is journal-driven: a .sql file that is not in the journal never runs,\n' +
      'and two branches that claim the same migration number merge into a journal that silently\n' +
      'drops one of them. Renumber the colliding migration (file and journal idx together) and\n' +
      're-run this audit.'
  );
  process.exit(1);
}
