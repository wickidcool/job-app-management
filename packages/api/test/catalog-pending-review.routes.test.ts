// WIC-1428 — a `pending_review` item raised on a resume upload must be reachable
// through the product, i.e. through the default, parameter-less
// `GET /api/catalog/diffs` that the shipped web client is hard-coded to call.
//
// These tests run the REAL `processCatalogChange` and the REAL `listDiffs` behind
// the REAL Hono route. Only the database is faked, and the fake honours the
// predicate it is handed (see `evaluate` below) rather than resolving the same
// fixture whatever it is asked. That distinction is the whole point: a row store
// that ignores the `where` reports green against the broken service too, because
// the diff comes back either way. WIC-1373 lost a review round to exactly that.
//
// The chain is genuine end-to-end at the row: the row the route lists in AC-1/AC-4
// is the row the extraction service actually inserted for text containing `PM`, not
// a hand-written fixture asserting what that row is assumed to look like.
//
// `@electric-sql/pglite` would be better still, but it is declared in NO
// package.json on `main` -- it resolves locally only as an optional peer of
// drizzle-orm. Importing it here is how WIC-1433 broke CI at import while the local
// suite was green.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { catalogDiffs } from '../src/db/schema.js';
import { processCatalogChange } from '../src/services/extraction.service.js';
import { resolveDiffItem } from '../src/services/catalog.service.js';
import { DEV_OWNER } from './helpers/local-dev-owner.js';

const dialect = new PgDialect();

/** db column name -> drizzle property name, read off the table so it cannot drift. */
const COLUMN_TO_PROPERTY = new Map<string, string>(
  Object.entries(catalogDiffs).flatMap(([prop, col]) =>
    col && typeof col === 'object' && 'name' in col ? [[(col as { name: string }).name, prop]] : []
  )
);

/**
 * Evaluate a rendered `catalog_diffs` predicate against one stored row.
 *
 * The clause is rendered to SQL by drizzle's own dialect and then rewritten into a
 * JS boolean expression. Deriving the test's notion of "does this row match" from
 * the service's own rendered SQL is what makes the negative controls bite: drop the
 * `openReviewCount > 0` arm from `listDiffs` and the rendered SQL changes, the
 * auto-applied row stops matching, and the AC-1 assertion goes red.
 *
 * Supports only the grammar `listDiffs` actually emits -- `col = $n`, `col > $n`,
 * `col is null`, grouped by `and` / `or`. Anything else throws rather than silently
 * evaluating to something convenient.
 */
function evaluate(clause: SQL | undefined, row: Record<string, unknown>): boolean {
  if (clause === undefined) return true;
  const { sql, params } = dialect.sqlToQuery(clause);

  const js = sql
    .replace(/"catalog_diffs"\."(\w+)" is not null/gi, (_m, c) => `${ref(c)} != null`)
    .replace(/"catalog_diffs"\."(\w+)" is null/gi, (_m, c) => `${ref(c)} == null`)
    .replace(
      /"catalog_diffs"\."(\w+)" (=|>|<|>=|<=) \$(\d+)/g,
      (_m, c, op, n) => `${ref(c)} ${op === '=' ? '===' : op} __p[${Number(n) - 1}]`
    )
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');

  const leftover = js.replace(/[()\s]|&&|\|\||===|!=|>=|<=|[<>]|__row\.\w+|__p\[\d+\]|null/g, '');
  if (leftover !== '') {
    throw new Error(`unsupported predicate fragment ${JSON.stringify(leftover)} in: ${sql}`);
  }

  return Function('__row', '__p', `return Boolean(${js});`)(row, params) as boolean;

  function ref(column: string): string {
    const prop = COLUMN_TO_PROPERTY.get(column);
    if (!prop) throw new Error(`unknown catalog_diffs column ${column}`);
    return `__row.${prop}`;
  }
}

/**
 * Fill in the column defaults Postgres would have applied, so a row the service
 * inserts without naming a column behaves here the way it behaves in production.
 * This is load-bearing for `openReviewCount`, whose DB default is 0: without it an
 * unset count would read `undefined`, and `undefined > 0` is false, which would let
 * a genuinely broken insert path pass the AC-3 assertion for the wrong reason.
 */
function withColumnDefaults(table: PgTable, values: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...values };
  for (const [prop, col] of Object.entries(table)) {
    if (prop in row || !col || typeof col !== 'object' || !('name' in col)) continue;
    const c = col as { hasDefault?: boolean; default?: unknown; columnType?: string };
    if (!c.hasDefault) continue;
    // `defaultNow()` records an SQL expression rather than a value; every other
    // default here is a literal.
    row[prop] =
      c.default !== null && typeof c.default === 'object' && 'queryChunks' in c.default
        ? new Date()
        : c.default;
  }
  return row;
}

/**
 * A fake `db` that records inserts per table and answers `catalog_diffs` selects by
 * evaluating the real predicate. Every other table reads back empty, which puts
 * `processCatalogChange` on its "nothing exists yet" path -- all changes are
 * creates, so a resume auto-applies, which is the case under test.
 */
function fakeDb() {
  const store = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: PgTable) => {
    const name = getTableName(t);
    if (!store.has(name)) store.set(name, []);
    return store.get(name)!;
  };

  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: PgTable) => {
        let where: SQL | undefined;
        let offset = 0;
        let limit = Infinity;
        const run = () => {
          const all = getTableName(table) === getTableName(catalogDiffs) ? rowsOf(table) : [];
          return all.filter((r) => evaluate(where, r)).slice(offset, offset + limit);
        };
        const builder: Record<string, unknown> = {
          where: (c?: SQL) => ((where = c), builder),
          orderBy: () => builder,
          limit: (n: number) => ((limit = n), builder),
          offset: (n: number) => ((offset = n), builder),
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve().then(run).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: PgTable) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        for (const one of Array.isArray(v) ? v : [v])
          rowsOf(table).push(withColumnDefaults(table, one));
        const done = {
          onConflictDoNothing: () => done,
          onConflictDoUpdate: () => done,
          then: (r: (v: unknown) => unknown) => Promise.resolve().then(() => r(undefined)),
        };
        return done;
      },
    }),
    update: (table: PgTable) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (c?: SQL) =>
          Promise.resolve().then(() => {
            for (const r of rowsOf(table)) if (evaluate(c, r)) Object.assign(r, patch);
          }),
      }),
    }),
    delete: (table: PgTable) => ({
      where: (c?: SQL) =>
        Promise.resolve().then(() => {
          const rows = rowsOf(table);
          for (let i = rows.length - 1; i >= 0; i--) if (evaluate(c, rows[i])) rows.splice(i, 1);
        }),
    }),
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  };

  return { db, diffRows: () => rowsOf(catalogDiffs as PgTable) };
}

/**
 * The uploader. `processCatalogChange` bails before doing anything when it
 * cannot resolve an owner, so this must carry one: an ownerless event never
 * reaches the code these tests are about.
 *
 * The list side runs `buildApp()` under the local-dev auth bypass, so the write
 * and the read have to agree on an owner for the diff to come back. Before
 * ADR-010 D3 they agreed by *absence* — the bypass emitted no `user_id` term at
 * all, so any uploader id was still reachable. D3 makes the bypass a real tenant
 * (WIC-1964), so they now agree by *identity* instead: the uploader is
 * `DEV_OWNER`, which is the caller the list resolves. These tests are about
 * reachability, not tenancy.
 */
const OWNER = DEV_OWNER;

/** Run the real extraction over `rawText` as a resume upload, as resume.service does. */
async function uploadResume(rawText: string, sourceId: string) {
  await processCatalogChange({
    id: sourceId,
    sourceType: 'resume',
    sourceId,
    changeType: 'created',
    timestamp: new Date().toISOString(),
    metadata: { rawText, userId: OWNER },
  } as Parameters<typeof processCatalogChange>[0]);
}

/**
 * `GET /api/catalog/diffs` answers with a `{ diffs, nextCursor }` envelope, not a
 * bare array. Unwrapped here in one place so the assertions below stay about
 * reachability rather than about the wire shape.
 */
async function defaultDiffList(app: ReturnType<typeof buildApp>) {
  const response = await app.request('/api/catalog/diffs', { method: 'GET' });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { diffs: Array<Record<string, unknown>> };
  expect(Array.isArray(body.diffs), 'expected a { diffs } envelope').toBe(true);
  return body.diffs;
}

describe('WIC-1428: pending_review items raised on a resume upload are reachable', () => {
  let app: ReturnType<typeof buildApp>;
  let harness: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = fakeDb();
    vi.mocked(getDb).mockReturnValue(harness.db as unknown as ReturnType<typeof getDb>);
    app = buildApp();
  });

  // ── AC-1 / AC-4 ────────────────────────────────────────────────────────────
  it('lists a resume-triggered diff containing the literal token PM in the default, parameter-less list', async () => {
    await uploadResume('Senior PM with React and TypeScript experience.', '01HZ_RESUME_PM');

    const [row] = harness.diffRows();
    expect(row, 'extraction should have written a diff row').toBeDefined();
    // AC-1: the changes are still applied exactly as before -- this is not a
    // regression to the manual-review path.
    expect(row.status).toBe('approved');
    expect(row.openReviewCount as number).toBeGreaterThanOrEqual(1);

    const diffs = await defaultDiffList(app);

    const listed = diffs.find((d) => d.id === row.id);
    expect(listed, 'the auto-applied diff must be reachable from the default list').toBeDefined();
    expect(listed!.pendingReviewCount as number).toBeGreaterThanOrEqual(1);
    expect(listed!.status).toBe('approved');
  });

  // The defect itself, pinned. The row is `approved`, so before WIC-1428 the
  // default list -- which filtered on `status = 'pending'` and nothing else --
  // could not return it. If someone restores that filter, the AC-1 test above goes
  // red and this one still passes, which is what tells you which arm broke.
  it('the reachable diff is genuinely approved, so only the open-review arm can surface it', async () => {
    await uploadResume('Senior PM with React experience.', '01HZ_RESUME_PM2');

    const pendingOnly = await app.request('/api/catalog/diffs?status=pending', { method: 'GET' });
    expect(((await pendingOnly.json()) as { diffs: unknown[] }).diffs).toEqual([]);

    const approvedOnly = await app.request('/api/catalog/diffs?status=approved', { method: 'GET' });
    expect(((await approvedOnly.json()) as { diffs: unknown[] }).diffs).toHaveLength(1);
  });

  // ── AC-3 ───────────────────────────────────────────────────────────────────
  it('adds no noise: a resume raising no pending_review items stays out of the default list', async () => {
    await uploadResume(
      'Senior engineer with React and TypeScript experience.',
      '01HZ_RESUME_CLEAN'
    );

    const [row] = harness.diffRows();
    expect(row).toBeDefined();
    expect(row.status).toBe('approved');
    expect(row.openReviewCount).toBe(0);
    expect((row.pendingReview as unknown[]).length).toBe(0);

    expect(await defaultDiffList(app)).toEqual([]);
  });

  // ── AC-2 ───────────────────────────────────────────────────────────────────
  it('drops out of the default list once every raised item has been decided', async () => {
    await uploadResume('Senior PM with React experience.', '01HZ_RESUME_PM3');

    const [row] = harness.diffRows();
    const items = (row.pendingReview as unknown[]).length;
    expect(items).toBeGreaterThanOrEqual(1);
    expect(await defaultDiffList(app)).toHaveLength(1);

    for (let i = 0; i < items - 1; i++) {
      await resolveDiffItem(row.id as string, {
        itemType: 'review',
        itemIndex: i,
        decision: 'approve',
        selectedOption: 'Product Manager',
      });
      expect(
        await defaultDiffList(app),
        'still listed while any raised item is undecided'
      ).toHaveLength(1);
    }

    await resolveDiffItem(row.id as string, {
      itemType: 'review',
      itemIndex: items - 1,
      decision: 'reject',
    });

    expect(row.openReviewCount).toBe(0);
    expect(await defaultDiffList(app), 'resolved ambiguities leave the list').toEqual([]);
  });

  it('re-submitting a decision for the same item does not drive the open count negative', async () => {
    await uploadResume('Senior PM with React experience.', '01HZ_RESUME_PM4');
    const [row] = harness.diffRows();
    const items = (row.pendingReview as unknown[]).length;

    for (let attempt = 0; attempt < 3; attempt++) {
      await resolveDiffItem(row.id as string, {
        itemType: 'review',
        itemIndex: 0,
        decision: 'approve',
        selectedOption: 'Project Manager',
      });
    }

    expect(row.openReviewCount).toBe(items - 1);
  });
});
