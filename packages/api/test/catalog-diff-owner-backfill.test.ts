/**
 * WIC-1408 — migration 0020 recovers the owner of `catalog_diffs` rows that
 * `POST /api/catalog/generate-diff` wrote with `user_id` NULL, and does not
 * guess at the ones it cannot.
 *
 * The engine is **PGlite**, a real Postgres, and it has to be. Everything under
 * test here is SQL semantics: `IS NULL` over a nullable uuid, an `UPDATE ...
 * FROM` join that can miss, and a `<>` against 0017's placeholder. A stub `db`
 * resolves whatever rows it was primed with regardless of the predicate, so it
 * would certify this migration with any `WHERE` clause at all — including none.
 * Two prior cards in this family shipped exactly that way.
 *
 * The SQL is **read off disk**, from the migration file the drizzle migrator
 * runs, and the census SQL is **imported** from the module the CLI imports.
 * Neither is retyped here; retyping would grade the copy.
 *
 * The DDL mirrors `db/schema.ts` at migration 0019, and its asymmetry is load
 * bearing: `catalog_diffs.user_id` is nullable (0017 step 2 omits the table) and
 * so are `resumes.user_id` and `applications.user_id` (0011 added them, nothing
 * has tightened them since). All three `id` columns are `text`, which is why the
 * migration's joins carry no cast — `TD_TYPE_MISMATCH` below fails loudly if any
 * of that stops being true.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ORPHAN_CENSUS_SQL,
  PLACEHOLDER_CENSUS_SQL,
  ORPHAN_OWNER,
  summarise,
} from '../scripts/lib/catalog-diff-owner-census.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The exact artifact `db:migrate` executes. Not a paraphrase of it. */
const MIGRATION_SQL = readFileSync(
  join(__dirname, '..', 'src', 'db', 'migrations', '0020_backfill_catalog_diffs_user_id.sql'),
  'utf8'
);

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

/** Post-0019 shape of the three tables the backfill touches. */
const DDL = `
CREATE TYPE diff_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TABLE resumes (
  id        text PRIMARY KEY,
  user_id   uuid,                       -- 0011 added it; never made NOT NULL
  file_name text NOT NULL DEFAULT 'cv.pdf'
);
CREATE TABLE applications (
  id        text PRIMARY KEY,
  user_id   uuid,                       -- 0011 added it; never made NOT NULL
  job_title text NOT NULL DEFAULT 'Engineer'
);
CREATE TABLE catalog_diffs (
  id             text PRIMARY KEY,
  user_id        uuid,                  -- omitted from 0017 step 2 on purpose
  trigger_source text NOT NULL,
  trigger_id     text NOT NULL,
  summary        text NOT NULL DEFAULT '',
  changes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_review jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         diff_status NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);`;

let db: PGlite;

const resume = (id: string, owner: string | null) =>
  db.query('INSERT INTO resumes (id, user_id) VALUES ($1, $2)', [id, owner]);

const application = (id: string, owner: string | null) =>
  db.query('INSERT INTO applications (id, user_id) VALUES ($1, $2)', [id, owner]);

const diff = (
  id: string,
  owner: string | null,
  triggerSource: string,
  triggerId: string,
  status: string = 'pending'
) =>
  db.query(
    'INSERT INTO catalog_diffs (id, user_id, trigger_source, trigger_id, status) VALUES ($1, $2, $3, $4, $5::diff_status)',
    [id, owner, triggerSource, triggerId, status]
  );

const ownerOf = async (id: string): Promise<string | null> => {
  const res = await db.query<{ user_id: string | null }>(
    'SELECT user_id FROM catalog_diffs WHERE id = $1',
    [id]
  );
  return res.rows[0]?.user_id ?? null;
};

const census = async () => {
  const res = await db.query<Record<string, unknown>>(ORPHAN_CENSUS_SQL);
  return res.rows[0];
};

const runBackfill = () => db.exec(MIGRATION_SQL);

// One engine for the file, truncated between cases. Standing a fresh PGlite up
// per test costs ~2s each and buys nothing here: every case seeds its own rows
// and the migration owns no state outside the three tables.
beforeAll(async () => {
  db = new PGlite();
  await db.exec(DDL);
}, 60_000);

beforeEach(async () => {
  await db.exec('TRUNCATE catalog_diffs, resumes, applications');
});

afterAll(async () => {
  await db.close();
});

describe('migration 0020 — catalog_diffs owner backfill', () => {
  describe('recovers what the trigger row knows', () => {
    it('restores a resume_upload diff to the uploader', async () => {
      await resume('res-alice', ALICE);
      await diff('diff-1', null, 'resume_upload', 'res-alice');

      await runBackfill();

      expect(await ownerOf('diff-1')).toBe(ALICE);
    });

    it('restores an app_change diff to the application owner', async () => {
      await application('app-bob', BOB);
      await diff('diff-2', null, 'app_change', 'app-bob');

      await runBackfill();

      expect(await ownerOf('diff-2')).toBe(BOB);
    });

    it('routes each row to its own owner rather than to one winner', async () => {
      // Two owners in one pass. A backfill written as a single unqualified
      // UPDATE, or one that resolved the owner once and reused it, passes both
      // tests above and fails this one.
      await resume('res-alice', ALICE);
      await application('app-bob', BOB);
      await diff('diff-a', null, 'resume_upload', 'res-alice');
      await diff('diff-b', null, 'app_change', 'app-bob');

      await runBackfill();

      expect(await ownerOf('diff-a')).toBe(ALICE);
      expect(await ownerOf('diff-b')).toBe(BOB);
    });

    it('does not cross the two trigger_source branches', async () => {
      // Same id in both tables, owned by different users. If either statement
      // dropped its `trigger_source` predicate the join would still find a row
      // — the wrong one — and nothing else in this file would notice.
      await resume('shared-id', ALICE);
      await application('shared-id', BOB);
      await diff('diff-r', null, 'resume_upload', 'shared-id');
      await diff('diff-a', null, 'app_change', 'shared-id');

      await runBackfill();

      expect(await ownerOf('diff-r')).toBe(ALICE);
      expect(await ownerOf('diff-a')).toBe(BOB);
    });
  });

  describe('leaves alone what it cannot know', () => {
    it('leaves a diff whose source row was deleted', async () => {
      await diff('diff-orphan', null, 'resume_upload', 'res-gone');

      await runBackfill();

      expect(await ownerOf('diff-orphan')).toBeNull();
    });

    it('leaves a diff whose source row is itself unowned', async () => {
      await resume('res-nobody', null);
      await diff('diff-nobody', null, 'resume_upload', 'res-nobody');

      await runBackfill();

      expect(await ownerOf('diff-nobody')).toBeNull();
    });

    it('does not launder 0017’s placeholder across from the source row', async () => {
      // The placeholder is not an owner. Copying it would silently move this row
      // out of the "unowned" census while leaving it exactly as unreachable —
      // the failure mode the migration's `<> placeholder` predicate exists for.
      await resume('res-placeholder', ORPHAN_OWNER);
      await application('app-placeholder', ORPHAN_OWNER);
      await diff('diff-p1', null, 'resume_upload', 'res-placeholder');
      await diff('diff-p2', null, 'app_change', 'app-placeholder');

      await runBackfill();

      expect(await ownerOf('diff-p1')).toBeNull();
      expect(await ownerOf('diff-p2')).toBeNull();
      expect((await census()).unowned_total).toBe(2);
    });

    it('does not touch a diff already carrying the placeholder', async () => {
      // 0017 step 1's own output. Recoverable by the same join, deliberately out
      // of scope — see the migration header.
      await resume('res-alice', ALICE);
      await diff('diff-pre0017', ORPHAN_OWNER, 'resume_upload', 'res-alice');

      await runBackfill();

      expect(await ownerOf('diff-pre0017')).toBe(ORPHAN_OWNER);
    });

    it('does not touch a diff that already has a real owner', async () => {
      await resume('res-alice', BOB); // deliberately mismatched
      await diff('diff-owned', ALICE, 'resume_upload', 'res-alice');

      await runBackfill();

      expect(await ownerOf('diff-owned')).toBe(ALICE);
    });

    it('ignores a trigger_source it does not model', async () => {
      await diff('diff-unknown', null, 'manual_edit', 'whatever');

      await runBackfill();

      expect(await ownerOf('diff-unknown')).toBeNull();
      expect((await census()).unknown_trigger_source).toBe(1);
    });
  });

  describe('operational properties', () => {
    it('is a no-op on an empty table', async () => {
      await expect(runBackfill()).resolves.toBeDefined();
      expect((await census()).unowned_total).toBe(0);
    });

    it('is idempotent — a second pass changes nothing', async () => {
      await resume('res-alice', ALICE);
      await application('app-bob', BOB);
      await diff('diff-a', null, 'resume_upload', 'res-alice');
      await diff('diff-b', null, 'app_change', 'app-bob');
      await diff('diff-stuck', null, 'resume_upload', 'res-gone');

      await runBackfill();
      const after1 = await db.query('SELECT id, user_id FROM catalog_diffs ORDER BY id');
      await runBackfill();
      const after2 = await db.query('SELECT id, user_id FROM catalog_diffs ORDER BY id');

      expect(after2.rows).toEqual(after1.rows);
      expect(after1.rows).toEqual([
        { id: 'diff-a', user_id: ALICE },
        { id: 'diff-b', user_id: BOB },
        { id: 'diff-stuck', user_id: null },
      ]);
    });

    it('TD_TYPE_MISMATCH — the joins hold without a cast', async () => {
      // A negative control for the whole file. If `trigger_id` or either `id`
      // stopped being `text`, or `user_id` stopped being `uuid`, the migration
      // would raise 42883 rather than silently recovering nothing — and every
      // assertion above would keep passing against a table it never touched.
      const cols = await db.query<{ table_name: string; column_name: string; data_type: string }>(
        `SELECT table_name, column_name, data_type
           FROM information_schema.columns
          WHERE (table_name = 'catalog_diffs' AND column_name IN ('trigger_id', 'user_id'))
             OR (table_name IN ('resumes', 'applications') AND column_name IN ('id', 'user_id'))
          ORDER BY table_name, column_name`
      );
      expect(cols.rows).toEqual([
        { table_name: 'applications', column_name: 'id', data_type: 'text' },
        { table_name: 'applications', column_name: 'user_id', data_type: 'uuid' },
        { table_name: 'catalog_diffs', column_name: 'trigger_id', data_type: 'text' },
        { table_name: 'catalog_diffs', column_name: 'user_id', data_type: 'uuid' },
        { table_name: 'resumes', column_name: 'id', data_type: 'text' },
        { table_name: 'resumes', column_name: 'user_id', data_type: 'uuid' },
      ]);
    });
  });

  describe('reversal checks — the predicates are load bearing', () => {
    // Each of these strips one clause out of the real migration text and asserts
    // the result is wrong. Without them a green suite would prove only that the
    // migration ran, not that any of its `WHERE` clauses does work. The mutants
    // are cut from MIGRATION_SQL itself, so a rewrite of the file that drops a
    // clause makes the corresponding `expect(applied)` fail rather than skipping
    // the check silently.
    const mutate = (from: string, to: string) => {
      const mutant = MIGRATION_SQL.replace(from, to);
      expect(mutant, `anchor not found, mutation never applied: ${from}`).not.toBe(MIGRATION_SQL);
      expect(
        MIGRATION_SQL.split(from).length - 1,
        `anchor matched more than one site: ${from}`
      ).toBe(1);
      return db.exec(mutant);
    };

    it('dropping the placeholder guard launders the orphan owner across', async () => {
      await resume('res-placeholder', ORPHAN_OWNER);
      await diff('diff-p1', null, 'resume_upload', 'res-placeholder');

      await mutate('AND r.user_id <> placeholder;', ';');

      expect(await ownerOf('diff-p1')).toBe(ORPHAN_OWNER);
    });

    it('dropping the trigger_source guard resolves against the wrong table', async () => {
      await resume('shared-id', ALICE);
      await application('shared-id', BOB);
      await diff('diff-a', null, 'app_change', 'shared-id');

      await mutate("AND d.trigger_source = 'resume_upload'\n", '');

      // The resume statement now claims the app_change row first.
      expect(await ownerOf('diff-a')).toBe(ALICE);
    });

    it('dropping the IS NULL guard overwrites a row that already had an owner', async () => {
      await resume('res-alice', BOB);
      await diff('diff-owned', ALICE, 'resume_upload', 'res-alice');

      await mutate(
        "WHERE d.user_id IS NULL\n     AND d.trigger_source = 'resume_upload'",
        "WHERE d.trigger_source = 'resume_upload'"
      );

      expect(await ownerOf('diff-owned')).toBe(BOB);
    });
  });

  describe('census SQL', () => {
    it('classifies every unowned row into exactly one bucket', async () => {
      await resume('res-alice', ALICE);
      await application('app-bob', BOB);
      await resume('res-nobody', null);
      await resume('res-placeholder', ORPHAN_OWNER);

      await diff('c-recoverable-r', null, 'resume_upload', 'res-alice', 'pending');
      await diff('c-recoverable-a', null, 'app_change', 'app-bob', 'approved');
      await diff('c-missing', null, 'resume_upload', 'res-gone');
      await diff('c-unowned', null, 'resume_upload', 'res-nobody');
      await diff('c-placeholder-src', null, 'resume_upload', 'res-placeholder');
      await diff('c-unknown', null, 'manual_edit', 'x');
      await diff('c-has-owner', ALICE, 'resume_upload', 'res-alice');

      const row = await census();

      expect(row.diffs_total).toBe(7);
      expect(row.unowned_total).toBe(6);
      expect(row.recoverable_via_resumes).toBe(1);
      expect(row.recoverable_via_applications).toBe(1);
      expect(row.source_row_missing).toBe(1);
      expect(row.source_row_unowned).toBe(2); // res-nobody and res-placeholder
      expect(row.unknown_trigger_source).toBe(1);
      expect(row.recoverable_pending).toBe(1); // c-recoverable-a is 'approved'
      expect(row.affected_users).toBe(2);

      // The buckets partition the unowned set — no row counted twice, none lost.
      const buckets = [
        row.recoverable_via_resumes,
        row.recoverable_via_applications,
        row.source_row_missing,
        row.source_row_unowned,
        row.unknown_trigger_source,
      ].reduce((a: number, b) => a + Number(b), 0);
      expect(buckets).toBe(Number(row.unowned_total));
    });

    it('predicts exactly what the backfill then recovers', async () => {
      // The census is the number the deploy decision is made on. If it and the
      // migration disagreed, the card's "count first" gate would be measuring
      // something other than the change.
      await resume('res-alice', ALICE);
      await application('app-bob', BOB);
      await resume('res-nobody', null);
      await diff('d1', null, 'resume_upload', 'res-alice');
      await diff('d2', null, 'app_change', 'app-bob');
      await diff('d3', null, 'resume_upload', 'res-nobody');
      await diff('d4', null, 'app_change', 'app-gone');

      const before = await census();
      const predicted =
        Number(before.recoverable_via_resumes) + Number(before.recoverable_via_applications);

      await runBackfill();

      const after = await census();
      expect(predicted).toBe(2);
      expect(Number(before.unowned_total) - Number(after.unowned_total)).toBe(predicted);
      expect(
        Number(after.recoverable_via_resumes) + Number(after.recoverable_via_applications)
      ).toBe(0);
    });

    it('counts the pre-0017 placeholder cohort separately from the NULL one', async () => {
      await resume('res-alice', ALICE);
      await resume('res-nobody', null);
      await diff('p-recoverable', ORPHAN_OWNER, 'resume_upload', 'res-alice');
      await diff('p-stuck', ORPHAN_OWNER, 'resume_upload', 'res-nobody');
      await diff('n-null', null, 'resume_upload', 'res-alice');

      const orphan = await census();
      const ph = (await db.query<Record<string, unknown>>(PLACEHOLDER_CENSUS_SQL)).rows[0];

      expect(orphan.unowned_total).toBe(1); // placeholder rows are not "unowned"
      expect(ph.placeholder_total).toBe(2);
      expect(ph.placeholder_recoverable).toBe(1);
    });

    it('summarise() reports a zero population as an answer, not a failure', async () => {
      const orphan = await census();
      const ph = (await db.query<Record<string, unknown>>(PLACEHOLDER_CENSUS_SQL)).rows[0];

      const { text, backfillWouldRecover } = summarise(orphan, ph);
      expect(backfillWouldRecover).toBe(0);
      expect(text).toContain('NOTHING TO RECOVER');
    });
  });
});
