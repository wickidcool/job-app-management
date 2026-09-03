#!/usr/bin/env node
// WIC-1939: fail the build when `meta/_journal.json` and the migrations
// directory disagree. See `migration-journal-guard.mjs` for the mechanism and
// the incident that motivated it.
//
// Run: node packages/api/scripts/audit-migration-journal.mjs
// Exits 1 on any violation. Also runs inside the api vitest suite
// (test/migration-journal.guard.test.ts), which additionally proves each check
// fires by mutating a synthetic tree.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { auditMigrationJournal } from './migration-journal-guard.mjs';

/**
 * No journal text could be obtained for the real migrations tree:
 * `meta/_journal.json` is absent from disk and no generator produced one.
 *
 * WIC-1981. Lives here rather than in the guard module's `CHECKS` because it is
 * emitted before there is any text to audit, so — unlike every member of
 * `CHECKS` — it has no synthetic mutant that could prove it. It exists because
 * WIC-1963 makes the journal a *generated, git-ignored* artifact, so "absent
 * from a fresh checkout" is the normal state rather than an error; but "absent
 * and underivable" still means `migrate()` applies nothing while exiting 0,
 * which is precisely the silent migration loss this guard is for. So an
 * unobtainable journal fails as a violation — never as an ENOENT stack trace,
 * and never as a pass.
 */
export const JOURNAL_UNAVAILABLE = 'journal-unavailable';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_DIR = join(__dirname, '..');
export const MIGRATIONS_DIR = join(PACKAGE_DIR, 'src', 'db', 'migrations');
export const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

// WIC-1963 turns `meta/_journal.json` into a generated, git-ignored artifact and
// adds this script to regenerate it. When that file exists the journal is
// *derived*, so an absent `_journal.json` is the ordinary state of a fresh
// checkout rather than a fault, and the audit has to produce the journal before
// it can audit anything.
export const JOURNAL_GENERATOR_PATH = join(PACKAGE_DIR, 'src', 'db', 'generate-journal.ts');
export const JOURNAL_GENERATOR_SCRIPT = 'db:journal';

/**
 * Obtain the real tree's journal text, generating it first when it is absent and
 * derivable.
 *
 * WIC-1981. This used to be a bare `readFileSync`, which was correct only while
 * the journal was committed. Under WIC-1963 it is generated and git-ignored, so
 * that read throws ENOENT on every fresh checkout — i.e. on every CI run, since
 * the deploy workflow runs this step unconditionally on all PRs. Three cases,
 * and the middle one is the reason this function exists:
 *
 *   1. the file is on disk  -> audit it (unchanged behaviour, and still the only
 *      path taken while the journal remains committed);
 *   2. the file is absent but the generator is present -> run the generator,
 *      then audit its output. This is strictly *more* meaningful than reading
 *      the file: it audits what `db:migrate` will actually apply, which
 *      regenerates the journal in-process immediately before migrating, rather
 *      than a checked-in copy that could be stale;
 *   3. the file is absent and there is no generator -> no journal, so
 *      `migrate()` applies nothing. That is a violation, reported as one.
 *
 * A generator that *fails* (its own same-number-collision throw, a TypeScript
 * error, a missing `tsx`) is also case 3: the tree cannot produce a journal, and
 * that must be loud. Its stderr is carried into the message so the real cause is
 * on screen rather than buried in an exit code.
 *
 * The paths are parameters rather than closed-over constants purely so the suite
 * can drive all three branches against a synthetic tree — the real one can only
 * ever exercise whichever branch the current checkout happens to be in.
 *
 * @param {object} [opts]
 * @param {string} [opts.journalPath] Where `_journal.json` lives.
 * @param {string} [opts.generatorPath] The generator whose presence means "derivable".
 * @param {string} [opts.packageDir] Working directory for the generator script.
 * @param {string} [opts.generatorScript] npm script name that writes the journal.
 * @returns {{ journalText: string|null, violation: { check: string, message: string }|null }}
 */
export function readRealJournalText({
  journalPath = JOURNAL_PATH,
  generatorPath = JOURNAL_GENERATOR_PATH,
  packageDir = PACKAGE_DIR,
  generatorScript = JOURNAL_GENERATOR_SCRIPT,
} = {}) {
  const unavailable = (message) => ({
    journalText: null,
    violation: { check: JOURNAL_UNAVAILABLE, message },
  });
  const here = (p) => relative(process.cwd(), p);

  if (existsSync(journalPath)) {
    return { journalText: readFileSync(journalPath, 'utf8'), violation: null };
  }

  if (!existsSync(generatorPath)) {
    return unavailable(
      `${here(journalPath)} does not exist and neither does the generator ${here(generatorPath)}. ` +
        "drizzle's migrate() is journal-driven, so with no journal it applies nothing at all and " +
        'still exits 0. Restore the committed journal, or add the generator (WIC-1963) so it can ' +
        'be derived from the .sql files.'
    );
  }

  try {
    // The generator is TypeScript and CI runs Node 20, which cannot import it
    // directly — so go through the workspace script, which is the same entry
    // point `db:generate` uses. Only reached when the journal is absent, so the
    // ordinary committed-journal path stays a filesystem read.
    execFileSync('npm', ['run', '--silent', generatorScript], {
      cwd: packageDir,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    const detail = (err.stderr || err.message || '').trim();
    return unavailable(
      `${here(journalPath)} is absent and \`npm run ${generatorScript}\` failed, so no journal ` +
        `could be derived from the .sql files:\n${detail}`
    );
  }

  if (!existsSync(journalPath)) {
    return unavailable(
      `\`npm run ${generatorScript}\` succeeded but did not write ${here(journalPath)}.`
    );
  }

  return { journalText: readFileSync(journalPath, 'utf8'), violation: null };
}

/** Read the real tree and audit it. Exported so the vitest suite runs the same code path CI does. */
export function auditRealMigrationTree() {
  const { journalText, violation } = readRealJournalText();
  if (journalText === null) return [violation];
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
