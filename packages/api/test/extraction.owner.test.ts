import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName } from 'drizzle-orm';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { processCatalogChange } from '../src/services/extraction.service.js';

/**
 * WIC-1617. Migration 0017 (`0017_enforce_userid_not_null.sql`, `:29`–`:34`) set
 * `user_id NOT NULL` on the five tables `applyChangeToDb` inserts into —
 * company_catalog, tech_stack_tags, job_fit_tags, quantified_bullets and
 * recurring_themes. The service wrote `userId: userId ?? null` into all five,
 * and `processCatalogChange` resolves `userId` to `undefined` whenever
 * `event.metadata.userId` is not a string. Executed against those migrations
 * under PGlite, all five inserts died on a `23502` not-null violation; the
 * `catalog_diffs` write, whose `user_id` 0017 deliberately leaves nullable,
 * succeeded — so the failure was specific to the constrained columns, not to
 * the harness.
 *
 * `flush()` wraps `processCatalogChange` in a try/catch that logs and moves on,
 * so the aborted transaction surfaced only as a console.error: the catalog
 * silently stopped ingesting.
 *
 * The fix declines to auto-apply an ownerless event rather than writing rows
 * nobody could read back — an anonymous caller scopes to `user_id IS NULL`,
 * which 0017 also made select the empty set (WIC-1449, and the read half PR
 * #206 pinned). The diff row is still recorded, as `pending` rather than
 * `approved`, so the changes survive for an owned caller to apply.
 *
 * These tests are deliberately paired. "No insert happened" is a vacuous oracle
 * on its own — it also passes when the fixture produces no changes at all, which
 * is exactly how a broken extraction would look. Every ownerless assertion below
 * has an owned counterpart driven by the *same* fixture text, so the owned case
 * proves the fixture really does reach those five tables.
 */

const OWNER = '11111111-2222-3333-4444-555555555555';

/** Resume text that reaches the tech-stack, job-fit and quantified-bullet paths. */
const RESUME_TEXT = [
  'EXPERIENCE',
  '',
  'Senior Engineer, Acme Corp (2020 - 2023)',
  'Built services in TypeScript and Python on AWS with PostgreSQL.',
  'Reduced p99 latency by 40% and cut infrastructure spend by 25%.',
  'Led a team of 6 engineers and mentored 3 juniors.',
  'Prefers remote work and collaborative teams.',
].join('\n');

type Insert = { table: string; values: Record<string, any> };

/**
 * A db double that records every insert, on the transaction and off it.
 *
 * `select().from().where()` resolves empty so every entity takes the `create`
 * branch — the branch that carries `userId` into a NOT NULL column.
 */
function stubDb() {
  const inserts: Insert[] = [];
  let transactionCalls = 0;

  const record = (table: unknown) => ({
    values: (values: Record<string, any>) => {
      inserts.push({ table: getTableName(table as any), values });
      const done = Promise.resolve([]);
      return Object.assign(done, {
        onConflictDoNothing: () => done,
        returning: () => done,
      });
    },
  });

  // The service both awaits `.from(t)` directly and chains `.where(...)` off it,
  // so `from` has to be thenable *and* carry `where`.
  const emptyRows = () => {
    const done = Promise.resolve([] as unknown[]);
    return Object.assign(done, { where: () => done, orderBy: () => done, limit: () => done });
  };
  const select = () => ({ from: emptyRows });
  const update = () => ({ set: () => ({ where: () => Promise.resolve([]) }) });

  const tx = { insert: record, update, select };

  const db = {
    insert: record,
    update,
    select,
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => {
      transactionCalls++;
      return cb(tx);
    },
  };

  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return {
    inserts,
    transactionCalls: () => transactionCalls,
    into: (table: string) => inserts.filter((i) => i.table === table),
  };
}

function resumeEvent(userId: string | null | undefined) {
  return {
    id: 'evt-1',
    sourceType: 'resume' as const,
    sourceId: 'resume-1',
    changeType: 'created' as const,
    timestamp: new Date().toISOString(),
    // `rawText` short-circuits getTextContent, so no storage is needed.
    metadata: { rawText: RESUME_TEXT, userId },
  };
}

/** The tables migration 0017 made `user_id NOT NULL`. */
const NOT_NULL_TABLES = [
  'company_catalog',
  'tech_stack_tags',
  'job_fit_tags',
  'quantified_bullets',
  'recurring_themes',
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('processCatalogChange owner handling (WIC-1617)', () => {
  it('auto-applies with an owner, and every NOT NULL user_id carries it', async () => {
    const db = stubDb();
    await processCatalogChange(resumeEvent(OWNER));

    // Positive control: this fixture really does reach the constrained tables.
    // Without this the ownerless assertions below would pass vacuously.
    expect(db.transactionCalls()).toBe(1);
    const constrained = db.inserts.filter((i) => NOT_NULL_TABLES.includes(i.table));
    expect(constrained.length).toBeGreaterThan(0);

    // The whole point: not one of them may be null or undefined.
    for (const insert of constrained) {
      expect(insert.values.userId, `${insert.table}.user_id`).toBe(OWNER);
    }
    expect(db.into('catalog_diffs')[0]?.values).toMatchObject({
      userId: OWNER,
      status: 'approved',
    });
  });

  it('covers all five NOT NULL tables with the owned fixture', async () => {
    const db = stubDb();
    await processCatalogChange(resumeEvent(OWNER));

    // Names the tables individually so a fixture that quietly stops reaching one
    // of them fails here rather than silently shrinking the test above.
    const reached = new Set(db.inserts.map((i) => i.table));
    expect([...NOT_NULL_TABLES].filter((t) => reached.has(t)).sort()).toEqual(
      [...NOT_NULL_TABLES].sort()
    );
  });

  it('writes nothing into a NOT NULL user_id when the event carries no owner', async () => {
    const db = stubDb();
    await processCatalogChange(resumeEvent(null));

    // Before the fix this ran the transaction and every insert died on a 23502.
    expect(db.transactionCalls()).toBe(0);
    expect(db.inserts.filter((i) => NOT_NULL_TABLES.includes(i.table))).toEqual([]);
  });

  it('records no diff at all when there is no owner', async () => {
    const db = stubDb();
    await processCatalogChange(resumeEvent(null));

    // This suite originally asserted the opposite — that the diff was still
    // written as `pending` — on the premise that `catalog_diffs.user_id` was
    // nullable. `processCatalogChange` now bails before any read or write when
    // it cannot resolve an owner, and WIC-1604 constrains that column NOT NULL,
    // so a pending ownerless row is neither reachable nor writable. Nothing is
    // lost: the five tables the apply path writes are all NOT NULL since 0017,
    // and an anonymous reader scopes to `user_id IS NULL`, which selects empty.
    expect(db.into('catalog_diffs')).toEqual([]);
  });

  it('treats a missing metadata.userId the same as an explicit null', async () => {
    const db = stubDb();
    await processCatalogChange(resumeEvent(undefined));

    expect(db.transactionCalls()).toBe(0);
    expect(db.inserts.filter((i) => NOT_NULL_TABLES.includes(i.table))).toEqual([]);
  });

  it('warns rather than failing silently when changes are declined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubDb();
    await processCatalogChange(resumeEvent(null));

    expect(warn.mock.calls.flat().join(' ')).toMatch(/no owner/i);
  });
});
