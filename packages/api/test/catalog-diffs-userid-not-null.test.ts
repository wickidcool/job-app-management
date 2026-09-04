/**
 * WIC-1604 — migration 0023 finishes what 0017 started: `catalog_diffs.user_id`
 * was in 0017's step-1 backfill list and absent from its step-2 `SET NOT NULL`
 * list, the only one of the seven omitted.
 *
 * The engine is **PGlite**, a real Postgres, and the migrations are the **real
 * files**, resolved the way `db:migrate` resolves them — not hand-written DDL
 * that mirrors them. That distinction is the whole point of the file. A retyped
 * `CREATE TABLE` grades my model of the schema; only executing the artifact
 * `db:migrate` executes can show that *the migration* produces the constraint. A
 * previous card in this family hand-rolled the DDL, omitted two columns the
 * inserts needed, and got a clean `0/5` that read exactly like "the finding is
 * wrong".
 *
 * WIC-1978 — "the real files" used to mean a `readdirSync` of the migrations
 * directory, sorted by filename, while this docstring claimed journal order. It
 * is now the journal: `meta/_journal.json` is read and `${tag}.sql` applied in
 * `entries` array order, which is what drizzle does. A directory listing agrees
 * with the journal only by convention — an unjournaled `.sql` runs here and never
 * in production, and filename sort order is journal order only while every tag's
 * numeric prefix matches its position. Both divergences are now assertions rather
 * than assumptions (see the `meta/_journal.json is the chain` block below).
 *
 * The chain is applied in two phases on purpose — everything before 0023, then
 * 0023 on its own — because AC-1 asks for the backfill count *before and after*,
 * and the only way to observe the sweep is to seed rows into the pre-0023 world
 * and watch what 0023 does to them.
 *
 * `*_rls` migrations are skipped: they GRANT against `auth.users`, which exists
 * only in a real Supabase instance, and they touch no column under test here.
 * They *are* journaled (0016 and 0019), so they are filtered by tag after the
 * journal is read, never by leaving them out of the listing — the skip is a
 * PGlite limitation, not a claim that drizzle ignores them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const ALICE = '11111111-1111-4111-8111-111111111111';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

/** The journal `db:migrate` reads, in the array order it applies. */
const journalTags = (): string[] =>
  (JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')).entries as JournalEntry[]).map((e) => e.tag);

/** Journaled, but ungrantable under PGlite — see the header. Matched on the tag. */
const isRlsGrant = (tag: string): boolean => tag.endsWith('_rls');

/** Every `.sql` on disk, whether or not the journal knows about it. */
const onDiskMigrations = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

/** Every migration `db:migrate` runs, in journal order, minus the RLS grants. */
const allMigrations = (): string[] =>
  journalTags()
    .filter((tag) => !isRlsGrant(tag))
    .map((tag) => `${tag}.sql`);

const THIS_MIGRATION = '0023_enforce_catalog_diffs_userid_not_null.sql';

/**
 * The chain up to but excluding `file`, positioned by the *journal* rather than
 * by a lexicographic comparison against the filename. The old
 * `filter((f) => f < THIS_MIGRATION)` was a second, quieter copy of the same
 * directory-order assumption.
 *
 * An absent `file` is not thrown on here. Throwing in the `describe` body kills
 * collection, and a suite that collects zero tests reports as `no tests` — which
 * tallies as "not failing" in exactly the sweeps that should catch it. Fall back
 * to the whole chain and let the `beforeAll` guard below name the problem as a
 * failed assertion.
 */
const chainBefore = (file: string): string[] => {
  const chain = allMigrations();
  const at = chain.indexOf(file);
  return chain.slice(0, at === -1 ? chain.length : at);
};

/** The exact artifact, not a paraphrase of it. */
const MIGRATION_SQL = readFileSync(join(MIGRATIONS_DIR, THIS_MIGRATION), 'utf8');

let db: PGlite;

async function applyThrough(files: string[]) {
  for (const f of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
}

const isNullable = async (table: string, column: string): Promise<string> => {
  const r = await db.query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  expect(r.rows, `${table}.${column} should exist`).toHaveLength(1);
  return r.rows[0].is_nullable;
};

const seedDiff = (id: string, owner: string | null) =>
  db.query(
    `INSERT INTO catalog_diffs (id, user_id, trigger_source, trigger_id, summary, changes)
     VALUES ($1, $2, 'resume_upload', 'r1', 's', '[]'::jsonb)`,
    [id, owner]
  );

const nullCount = async (): Promise<number> => {
  const r = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM catalog_diffs WHERE user_id IS NULL'
  );
  return r.rows[0].n;
};

/**
 * WIC-1978 — the chain builder's own premises. These are the assertions that
 * make "the migrations `db:migrate` runs" true rather than merely intended, and
 * they are deliberately outside the PGlite `beforeEach` above: they read files,
 * not a database, and should not pay for a Postgres boot.
 */
describe('meta/_journal.json is the chain', () => {
  it('is what the chain is built from — every entry, in array order', () => {
    const journaled = journalTags();
    expect(journaled.length).toBeGreaterThan(0);
    // The applied chain is the journal minus the RLS grants, order preserved.
    expect(allMigrations()).toEqual(journaled.filter((t) => !isRlsGrant(t)).map((t) => `${t}.sql`));
    // ...and the RLS skip really is dropping journaled entries, not dead files.
    expect(journaled.filter(isRlsGrant)).not.toHaveLength(0);
  });

  /**
   * The divergence the old `readdirSync` builder could not see. Delete a journal
   * entry and leave its `.sql` on disk and the directory listing still applies
   * it — here, and never in production. Reverse it and the suite is exercising a
   * file drizzle cannot find.
   */
  it('accounts for every .sql on disk — no unjournaled migration, no missing file', () => {
    expect(
      journalTags()
        .map((t) => `${t}.sql`)
        .sort()
    ).toEqual(onDiskMigrations());
  });

  /**
   * Filename sort order and journal order coincide today. That is a convention,
   * so assert it rather than depending on it silently — the moment a renumber
   * breaks it, the old builder would have applied a different chain than
   * `db:migrate` while reporting green.
   */
  it('is in the same order a filename sort would give — today, and checked', () => {
    const journaled = journalTags().map((t) => `${t}.sql`);
    expect(journaled).toEqual([...journaled].sort());
  });
});

describe('WIC-1604 — 0023 constrains catalog_diffs.user_id', () => {
  const beforeThisMigration = chainBefore(THIS_MIGRATION);

  beforeAll(() => {
    // Guard the premise this whole file rests on: 0023 must be journaled — so
    // that `db:migrate` would actually apply it — and must not already be inside
    // the "before" phase.
    expect(allMigrations(), `${THIS_MIGRATION} must be journaled in meta/_journal.json`).toContain(
      THIS_MIGRATION
    );
    expect(beforeThisMigration).not.toContain(THIS_MIGRATION);
  });

  beforeEach(async () => {
    db = new PGlite();
    await applyThrough(beforeThisMigration);
  });

  afterEach(async () => {
    await db?.close();
  });

  it('leaves the column nullable through 0022 — the gap this card is about', async () => {
    expect(await isNullable('catalog_diffs', 'user_id')).toBe('YES');
    // and a NULL really can be written in that world
    await seedDiff('d-pre', null);
    expect(await nullCount()).toBe(1);
  });

  it('sweeps pre-existing NULLs to the placeholder and reports before/after', async () => {
    await seedDiff('d1', null);
    await seedDiff('d2', null);
    await seedDiff('d3', ALICE);
    expect(await nullCount()).toBe(2); // before

    await db.exec(MIGRATION_SQL);

    expect(await nullCount()).toBe(0); // after
    const r = await db.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM catalog_diffs ORDER BY id'
    );
    expect(r.rows).toEqual([
      { id: 'd1', user_id: PLACEHOLDER },
      { id: 'd2', user_id: PLACEHOLDER },
      { id: 'd3', user_id: ALICE }, // an owned row is not touched
    ]);
  });

  it('makes the column NOT NULL, so a new ownerless row is rejected', async () => {
    await db.exec(MIGRATION_SQL);

    expect(await isNullable('catalog_diffs', 'user_id')).toBe('NO');
    await expect(seedDiff('d-after', null)).rejects.toThrow(/not-null constraint|23502/);
    // the owned write still works — the constraint is not a blanket refusal
    await seedDiff('d-owned', ALICE);
    expect((await db.query('SELECT 1 FROM catalog_diffs')).rows).toHaveLength(1);
  });

  it('is idempotent — a second pass sweeps nothing and still holds', async () => {
    await seedDiff('d1', null);
    await db.exec(MIGRATION_SQL);
    await db.exec(MIGRATION_SQL);

    expect(await isNullable('catalog_diffs', 'user_id')).toBe('NO');
    expect(await nullCount()).toBe(0);
  });

  /**
   * Negative controls. Without these, "the column is NOT NULL" is equally
   * consistent with a harness that reports NOT NULL for everything, and
   * AC-5 has no teeth.
   */
  it('does not sweep up the columns that are nullable by design', async () => {
    await db.exec(MIGRATION_SQL);

    // AC-5 — single-user local rows genuinely carry NULL here.
    expect(await isNullable('personal_info', 'user_id')).toBe('YES');
    // 0011 added these; nothing has tightened them, and 0023 must not either.
    expect(await isNullable('resumes', 'user_id')).toBe('YES');
    expect(await isNullable('applications', 'user_id')).toBe('YES');
    expect(await isNullable('cover_letters', 'user_id')).toBe('YES');
  });

  it('leaves the six tables 0017 already constrained exactly as they were', async () => {
    await db.exec(MIGRATION_SQL);

    for (const t of [
      'projects',
      'company_catalog',
      'job_fit_tags',
      'tech_stack_tags',
      'quantified_bullets',
      'recurring_themes',
    ]) {
      expect(await isNullable(t, 'user_id'), t).toBe('NO');
    }
  });

  /**
   * Reversal check. The assertions above are satisfied by any migration that
   * ends in `SET NOT NULL`, including one that drops the rows instead of
   * backfilling them. Cut the UPDATE out of the real text and the migration
   * must fail loudly rather than quietly constrain an empty-ish table.
   */
  it('fails loudly if the backfill is removed but the constraint kept', async () => {
    const anchor = 'UPDATE catalog_diffs SET user_id = placeholder WHERE user_id IS NULL;';
    expect(MIGRATION_SQL.split(anchor)).toHaveLength(2); // exactly one site
    const mutant = MIGRATION_SQL.replace(anchor, '');

    await seedDiff('d1', null);
    await expect(db.exec(mutant)).rejects.toThrow(/still have a NULL user_id|not-null/);
  });
});
