import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/services/extraction.service.js', () => ({
  processCatalogChange: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '../src/db/client.js';
import { processCatalogChange } from '../src/services/extraction.service.js';
import {
  generateDiff,
  mergeCompanies,
  mergeJobFitTags,
  mergeTechStackTags,
  updateJobFitTag,
  updateTechStackTag,
} from '../src/services/catalog.service.js';
import { NotFoundError } from '../src/types/index.js';

/**
 * UC-2 (WIC-101) named exactly two integrity constraints: "no duplicate entries
 * across companies" and "tag taxonomy must be consistent (no AI-ML vs ai-ml
 * drift)". Both ship as merge endpoints. The route tests in
 * catalog.routes.test.ts cover the HTTP contract with the service mocked out;
 * these cover the merge arithmetic itself, which is only observable in the
 * payloads written to the DB.
 *
 * Note on the taxonomy constraint: canonicalisation happens at ingest
 * (normalizeTechSlug / slugify in extraction.service.ts lowercase every slug).
 * mergeJobFitTags / mergeTechStackTags are the remediation path for drift that
 * is already in the catalog — they fold a duplicate into a survivor rather than
 * re-deriving a canonical slug.
 */

/**
 * Build a db double whose select() chain resolves the given rows in order.
 *
 * The returned `where` spies hold the Drizzle predicate objects the service
 * built, which is what the tenancy tests below assert on — see `queryFor`.
 */
function stubDb(selectResults: unknown[][], updateResults: unknown[][] = []) {
  const where = vi.fn();
  for (const rows of selectResults) where.mockResolvedValueOnce(rows);

  // Top-level (non-transactional) update chain, used by the tag PATCH services:
  // db.update(t).set(...).where(...).returning().
  const returning = vi.fn();
  for (const rows of updateResults) returning.mockResolvedValueOnce(rows);
  returning.mockResolvedValue([]);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  // One shared spy across every update in the transaction, so a test can read
  // the predicate of each write in call order.
  const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const txSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
  const txUpdate = vi.fn().mockReturnValue({ set: txSet });
  const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });

  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
    cb({ update: txUpdate, delete: txDelete })
  );

  const db = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }),
    update,
    transaction,
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);

  return {
    selectWhere: where,
    update,
    updateSet,
    updateWhere,
    txSet,
    txUpdate,
    txUpdateWhere,
    txDelete,
    txDeleteWhere,
    transaction,
  };
}

const dialect = new PgDialect();

/**
 * Render a Drizzle where-clause to the SQL it would actually run. Asserting on
 * the rendered predicate is what makes the tenancy tests mutation-proof:
 * dropping the `eq(table.userId, userId)` term changes this string, whereas a
 * `toHaveBeenCalled()` check would still pass.
 */
function queryFor(clause: unknown) {
  return dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
}

/** The clause filters on user_id, bound to this exact caller. */
function expectScopedTo(clause: unknown, userId: string) {
  const { sql, params } = queryFor(clause);
  expect(sql).toContain('"user_id" = $');
  expect(params).toContain(userId);
}

/** The clause carries no tenancy term at all (single-user / local mode). */
function expectUnscoped(clause: unknown) {
  expect(queryFor(clause).sql).not.toContain('user_id');
}

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01HZ_CO_001',
    userId: '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60',
    name: 'Acme Corp',
    normalizedName: 'acme-corp',
    aliases: [] as string[],
    firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
    applicationCount: 2,
    latestStatus: 'applied',
    latestAppId: null,
    isDeleted: false,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function tagRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01HZ_TAG_001',
    userId: '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60',
    tagSlug: 'ai-ml',
    displayName: 'AI/ML',
    category: 'role',
    mentionCount: 3,
    sourceIds: ['01HZ_RESUME_001'],
    aliases: [] as string[],
    needsReview: false,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

describe('mergeCompanies', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sums applicationCount across the target and every source', async () => {
    const target = companyRow({ id: '01HZ_CO_001', applicationCount: 2 });
    const sources = [
      companyRow({ id: '01HZ_CO_002', name: 'Acme Corporation', applicationCount: 3 }),
      companyRow({ id: '01HZ_CO_003', name: 'ACME', applicationCount: 4 }),
    ];
    const { txSet } = stubDb([
      [target],
      sources,
      [companyRow({ applicationCount: 9, version: 2 })],
    ]);

    await mergeCompanies(['01HZ_CO_002', '01HZ_CO_003'], '01HZ_CO_001');

    expect(txSet.mock.calls[0][0]).toMatchObject({ applicationCount: 9 });
  });

  it('folds every source name into the target aliases without duplicates', async () => {
    const target = companyRow({ aliases: ['ACME'] });
    const sources = [
      companyRow({ id: '01HZ_CO_002', name: 'Acme Corporation' }),
      companyRow({ id: '01HZ_CO_003', name: 'ACME' }),
    ];
    const { txSet } = stubDb([[target], sources, [companyRow()]]);

    await mergeCompanies(['01HZ_CO_002', '01HZ_CO_003'], '01HZ_CO_001');

    const aliases = (txSet.mock.calls[0][0] as { aliases: string[] }).aliases;
    expect(aliases).toContain('Acme Corporation');
    expect(aliases.filter((a) => a === 'ACME')).toHaveLength(1);
  });

  it('bumps the target version and soft-deletes the sources in one transaction', async () => {
    const target = companyRow({ version: 4 });
    const { txSet, txUpdate, transaction } = stubDb([
      [target],
      [companyRow({ id: '01HZ_CO_002' })],
      [companyRow()],
    ]);

    await mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txSet.mock.calls[0][0]).toMatchObject({ version: 5 });
    // Second update in the same transaction retires the source rows.
    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(txSet.mock.calls[1][0]).toMatchObject({ isDeleted: true });
  });

  it('reports how many sources were folded in', async () => {
    const sources = [companyRow({ id: '01HZ_CO_002' }), companyRow({ id: '01HZ_CO_003' })];
    stubDb([[companyRow()], sources, [companyRow()]]);

    const result = await mergeCompanies(['01HZ_CO_002', '01HZ_CO_003'], '01HZ_CO_001');

    expect(result.mergedCount).toBe(2);
  });

  it('throws NotFoundError when the target company does not exist', async () => {
    stubDb([[]]);

    await expect(mergeCompanies(['01HZ_CO_002'], 'nonexistent')).rejects.toThrow(NotFoundError);
  });

  // ── first_seen_at retention (WIC-1360) ─────────────────────────────────────
  //
  // Merging preserves the earliest sighting across everything folded together —
  // that date is what the catalog reports as `firstSeen`, and it is the only
  // record that the older duplicate ever existed. The survivor's date must move
  // backwards or stay put, never forwards, and the sources are soft-deleted, so
  // getting it wrong is unrecoverable through the API. The three cases below
  // pin the minimum: it can lower, it does not raise, and it looks at every
  // source rather than just the first.

  it('keeps the earliest firstSeenAt when an older duplicate is merged in', async () => {
    const target = companyRow({ firstSeenAt: new Date('2026-06-01T00:00:00.000Z') });
    const older = companyRow({
      id: '01HZ_CO_002',
      name: 'Acme Corporation',
      firstSeenAt: new Date('2026-01-15T00:00:00.000Z'),
    });
    const { txSet } = stubDb([[target], [older], [companyRow()]]);

    await mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001');

    expect(txSet.mock.calls[0][0]).toMatchObject({
      firstSeenAt: new Date('2026-01-15T00:00:00.000Z'),
    });
  });

  it('keeps the target firstSeenAt when every source was seen later', async () => {
    const target = companyRow({ firstSeenAt: new Date('2026-01-15T00:00:00.000Z') });
    const newer = companyRow({
      id: '01HZ_CO_002',
      name: 'Acme Corporation',
      firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const { txSet } = stubDb([[target], [newer], [companyRow()]]);

    await mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001');

    // Merging must never walk the date forward — an unconditional
    // `firstSeenAt: sources[0].firstSeenAt` would pass the test above and fail here.
    expect(txSet.mock.calls[0][0]).toMatchObject({
      firstSeenAt: new Date('2026-01-15T00:00:00.000Z'),
    });
  });

  it('takes the minimum across every source, not just the first one', async () => {
    const target = companyRow({ firstSeenAt: new Date('2026-06-01T00:00:00.000Z') });
    const sources = [
      companyRow({
        id: '01HZ_CO_002',
        name: 'Acme Corporation',
        firstSeenAt: new Date('2026-05-01T00:00:00.000Z'),
      }),
      companyRow({
        id: '01HZ_CO_003',
        name: 'ACME',
        firstSeenAt: new Date('2026-01-15T00:00:00.000Z'),
      }),
    ];
    const { txSet } = stubDb([[target], sources, [companyRow()]]);

    await mergeCompanies(['01HZ_CO_002', '01HZ_CO_003'], '01HZ_CO_001');

    expect(txSet.mock.calls[0][0]).toMatchObject({
      firstSeenAt: new Date('2026-01-15T00:00:00.000Z'),
    });
  });
});

describe('mergeJobFitTags', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sums mentionCount across the survivor and the drifted duplicates', async () => {
    const target = tagRow({ tagSlug: 'ai-ml', mentionCount: 3 });
    const drifted = tagRow({ id: '01HZ_TAG_002', tagSlug: 'AI-ML', mentionCount: 5 });
    const { txSet } = stubDb([[target], [drifted], [tagRow({ mentionCount: 8 })]]);

    await mergeJobFitTags(['01HZ_TAG_002'], '01HZ_TAG_001');

    expect(txSet.mock.calls[0][0]).toMatchObject({ mentionCount: 8 });
  });

  it('unions sourceIds so no reference is orphaned by the merge', async () => {
    const target = tagRow({ sourceIds: ['01HZ_RESUME_001'] });
    const drifted = tagRow({
      id: '01HZ_TAG_002',
      tagSlug: 'AI-ML',
      sourceIds: ['01HZ_RESUME_002', '01HZ_RESUME_001'],
    });
    const { txSet } = stubDb([[target], [drifted], [tagRow()]]);

    await mergeJobFitTags(['01HZ_TAG_002'], '01HZ_TAG_001');

    const sourceIds = (txSet.mock.calls[0][0] as { sourceIds: string[] }).sourceIds;
    expect(sourceIds).toEqual(expect.arrayContaining(['01HZ_RESUME_001', '01HZ_RESUME_002']));
    // De-duplicated: the shared resume appears once, not twice.
    expect(sourceIds.filter((s) => s === '01HZ_RESUME_001')).toHaveLength(1);
  });

  it('retains the drifted slug as an alias so the old spelling stays searchable', async () => {
    const target = tagRow({ tagSlug: 'ai-ml' });
    const drifted = tagRow({ id: '01HZ_TAG_002', tagSlug: 'AI-ML' });
    const { txSet } = stubDb([[target], [drifted], [tagRow()]]);

    await mergeJobFitTags(['01HZ_TAG_002'], '01HZ_TAG_001');

    expect((txSet.mock.calls[0][0] as { aliases: string[] }).aliases).toContain('AI-ML');
  });

  it('leaves the survivor slug untouched — merge folds in, it does not re-canonicalise', async () => {
    const target = tagRow({ tagSlug: 'ai-ml' });
    const { txSet } = stubDb([
      [target],
      [tagRow({ id: '01HZ_TAG_002', tagSlug: 'AI-ML' })],
      [tagRow()],
    ]);

    await mergeJobFitTags(['01HZ_TAG_002'], '01HZ_TAG_001');

    expect(txSet.mock.calls[0][0]).not.toHaveProperty('tagSlug');
  });

  it('hard-deletes each duplicate tag so the taxonomy is left with one entry', async () => {
    const { txDelete, txDeleteWhere } = stubDb([
      [tagRow()],
      [tagRow({ id: '01HZ_TAG_002' }), tagRow({ id: '01HZ_TAG_003' })],
      [tagRow()],
    ]);

    await mergeJobFitTags(['01HZ_TAG_002', '01HZ_TAG_003'], '01HZ_TAG_001');

    expect(txDelete).toHaveBeenCalledTimes(2);
    expect(txDeleteWhere).toHaveBeenCalledTimes(2);
  });

  it('throws NotFoundError when the survivor tag does not exist', async () => {
    stubDb([[]]);

    await expect(mergeJobFitTags(['01HZ_TAG_002'], 'nonexistent')).rejects.toThrow(NotFoundError);
  });
});

// ── Tenancy scoping (WIC-1365) ───────────────────────────────────────────────
//
// The merge trio takes the caller's user id and used to ignore it entirely: the
// parameter was `_userId` and every lookup and write was keyed on id alone. An
// authenticated user who knew a ULID could fold another user's companies into a
// target (soft-deleting the sources) or hard-delete another user's tags.
//
// The fix mirrors `resolveDiffItem`: scope on userId when there is one, and
// leave the predicate alone when there is not, so single-user/local mode
// (SUPABASE_JWT_SECRET unset -> userId null) keeps working unchanged. These
// tests assert on the rendered SQL rather than on call counts, so removing the
// tenancy term fails them.

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

describe('merge tenancy scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('mergeCompanies', () => {
    it('scopes the target read, the source read and both writes to the caller', async () => {
      const { selectWhere, txUpdateWhere } = stubDb([
        [companyRow()],
        [companyRow({ id: '01HZ_CO_002' })],
        [companyRow()],
      ]);

      await mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001', CALLER);

      // Reads: target, then sources.
      expectScopedTo(selectWhere.mock.calls[0][0], CALLER);
      expectScopedTo(selectWhere.mock.calls[1][0], CALLER);
      // Writes: fold into the target, then soft-delete the sources. The second
      // one is the destructive half — an id-only predicate there would retire
      // another user's rows even if the read above excluded them.
      expect(txUpdateWhere).toHaveBeenCalledTimes(2);
      expectScopedTo(txUpdateWhere.mock.calls[0][0], CALLER);
      expectScopedTo(txUpdateWhere.mock.calls[1][0], CALLER);
    });

    it('reports the target as not found when it belongs to another user', async () => {
      // The scoped read returns nothing even though the row exists.
      stubDb([[]]);

      await expect(mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001', CALLER)).rejects.toThrow(
        NotFoundError
      );
    });

    it('leaves the predicates unscoped in single-user mode', async () => {
      const { selectWhere, txUpdateWhere } = stubDb([
        [companyRow()],
        [companyRow({ id: '01HZ_CO_002' })],
        [companyRow()],
      ]);

      await mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001', undefined);

      expectUnscoped(selectWhere.mock.calls[0][0]);
      expectUnscoped(selectWhere.mock.calls[1][0]);
      expectUnscoped(txUpdateWhere.mock.calls[0][0]);
      expectUnscoped(txUpdateWhere.mock.calls[1][0]);
    });
  });

  describe.each([
    ['mergeJobFitTags', mergeJobFitTags],
    ['mergeTechStackTags', mergeTechStackTags],
  ] as const)('%s', (_name, merge) => {
    it('scopes the target read, the source read, the update and the delete', async () => {
      const { selectWhere, txUpdateWhere, txDeleteWhere } = stubDb([
        [tagRow()],
        [tagRow({ id: '01HZ_TAG_002' })],
        [tagRow()],
      ]);

      await merge(['01HZ_TAG_002'], '01HZ_TAG_001', CALLER);

      expectScopedTo(selectWhere.mock.calls[0][0], CALLER);
      expectScopedTo(selectWhere.mock.calls[1][0], CALLER);
      expectScopedTo(txUpdateWhere.mock.calls[0][0], CALLER);
      // The delete is unrecoverable — there is no soft-delete for tags.
      expect(txDeleteWhere).toHaveBeenCalledTimes(1);
      expectScopedTo(txDeleteWhere.mock.calls[0][0], CALLER);
    });

    it('does not delete a source id the scoped read excluded', async () => {
      // Caller names two sources; only one comes back from the scoped read
      // because the other belongs to somebody else. The loop must follow the
      // read, not the raw id list.
      const { txDeleteWhere } = stubDb([[tagRow()], [tagRow({ id: '01HZ_TAG_002' })], [tagRow()]]);

      const result = await merge(['01HZ_TAG_002', '01HZ_TAG_OTHER_USER'], '01HZ_TAG_001', CALLER);

      expect(txDeleteWhere).toHaveBeenCalledTimes(1);
      expect(queryFor(txDeleteWhere.mock.calls[0][0]).params).toContain('01HZ_TAG_002');
      expect(queryFor(txDeleteWhere.mock.calls[0][0]).params).not.toContain('01HZ_TAG_OTHER_USER');
      expect(result.mergedCount).toBe(1);
    });

    it('reports the survivor as not found when it belongs to another user', async () => {
      stubDb([[]]);

      await expect(merge(['01HZ_TAG_002'], '01HZ_TAG_001', CALLER)).rejects.toThrow(NotFoundError);
    });

    it('leaves the predicates unscoped in single-user mode', async () => {
      const { selectWhere, txUpdateWhere, txDeleteWhere } = stubDb([
        [tagRow()],
        [tagRow({ id: '01HZ_TAG_002' })],
        [tagRow()],
      ]);

      await merge(['01HZ_TAG_002'], '01HZ_TAG_001', undefined);

      expectUnscoped(selectWhere.mock.calls[0][0]);
      expectUnscoped(selectWhere.mock.calls[1][0]);
      expectUnscoped(txUpdateWhere.mock.calls[0][0]);
      expectUnscoped(txDeleteWhere.mock.calls[0][0]);
    });
  });
});

// ── WIC-1377: the merge source read has to be valid Postgres ─────────────────
// The source predicate used to be sql`${table.id} = ANY(${sourceIds})`. Drizzle
// expands a JS array interpolated into a `sql` template as a comma-separated
// parameter list, not as an array parameter, so that rendered
// `"t"."id" = ANY(($1, $2))`. `($1, $2)` is a row constructor and `= ANY(...)`
// wants an array or a subquery, so Postgres rejected it with `op ANY/ALL (array)
// requires array on right side` — all three merge endpoints returned 500 for
// every input, in both scoped and single-user mode.
//
// Nothing above catches this: stubDb resolves rows for whatever predicate it is
// handed, and the tenancy assertions only look at the user_id term and the bound
// params — which are identical for the broken and the fixed spelling. Only the
// rendered SQL string tells them apart, so that is what these assert on.

describe.each([
  ['mergeCompanies', mergeCompanies, 'company_catalog', companyRow],
  ['mergeJobFitTags', mergeJobFitTags, 'job_fit_tags', tagRow],
  ['mergeTechStackTags', mergeTechStackTags, 'tech_stack_tags', tagRow],
] as const)('%s source read', (_name, merge, table, row) => {
  beforeEach(() => vi.clearAllMocks());

  /** Render the source read — the second select — for a given call. */
  async function sourceRead(sourceIds: string[], userId?: string) {
    const { selectWhere } = stubDb([[row()], sourceIds.map((id) => row({ id })), [row()]]);
    await merge(sourceIds, 'TARGET', userId);
    return queryFor(selectWhere.mock.calls[1][0]);
  }

  it('renders an IN list, not a row constructor, for several ids', async () => {
    const { sql, params } = await sourceRead(['A', 'B'], CALLER);

    expect(sql).toBe(`("${table}"."id" in ($1, $2) and "${table}"."user_id" = $3)`);
    expect(params).toEqual(['A', 'B', CALLER]);
  });

  it('renders an IN list for a single id', async () => {
    // The one-id case failed differently and more confusingly: `= ANY(($1))`
    // parses, then dies at run time with `malformed array literal: "A"`, which
    // reads like bad input rather than a bad query.
    const { sql, params } = await sourceRead(['A'], CALLER);

    expect(sql).toBe(`("${table}"."id" in ($1) and "${table}"."user_id" = $2)`);
    expect(params).toEqual(['A', CALLER]);
  });

  it('renders an IN list in single-user mode too', async () => {
    const { sql, params } = await sourceRead(['A', 'B'], undefined);

    expect(sql).toBe(`"${table}"."id" in ($1, $2)`);
    expect(params).toEqual(['A', 'B']);
  });

  it('never emits ANY(( in any mode', async () => {
    for (const ids of [['A', 'B'], ['A']]) {
      for (const caller of [CALLER, undefined]) {
        expect((await sourceRead(ids, caller)).sql).not.toContain('ANY(');
      }
    }
  });

  it('rejects an empty source list instead of failing inside the query builder', async () => {
    // `inArray(col, [])` throws `inArray requires at least one value` on the
    // drizzle-orm pinned here (0.30.10) rather than rendering `false`, so the
    // service has to reject the empty list itself or the caller gets a 500.
    // The routes already enforce `.min(1)`; this covers a direct service call.
    const { selectWhere } = stubDb([[row()]]);

    await expect(merge([], 'TARGET', CALLER)).rejects.toMatchObject({
      name: 'AppError',
      code: 'BAD_REQUEST',
      statusCode: 400,
    });
    expect(selectWhere).not.toHaveBeenCalled();
  });
});

// ── WIC-1395: a merge target must not appear in its own source list ───────────
// `sourcesWhere` is built from `sourceIds` alone and is exactly the predicate
// the merge deletes by, so a target listed among its own sources was destroyed
// by its own merge. Measured on a real engine before the guard landed:
//   mergeCompanies(['X'], 'X')    -> HTTP 200, company X isDeleted = true
//                                    (silent destructive success)
//   mergeJobFitTags(['T'], 'T')   -> target row HARD DELETED, then `updated!`
//                                    is undefined -> TypeError -> HTTP 500
// Only reachable at all because WIC-1377 repaired the source read above; every
// merge previously died at that read before any write ran.
//
// These assert on the surviving row state, not just on the rejection: a version
// that deleted first and rejected afterwards would satisfy a rejects-only test.

/**
 * A db double backed by a mutable row store that honours where-clauses across
 * the transactional write path — update and delete included, which neither
 * stubDb nor stubOwnedRow model.
 *
 * Visibility, per row: the clause's bound params must name the row's id, and a
 * clause carrying a user_id term must bind that row's owner. That is enough to
 * distinguish every predicate the merge trio builds (`eq(id) [and eq(userId)]`
 * for the target, `inArray(id) [and eq(userId)]` for the sources).
 */
function stubRowStore(rows: Array<Record<string, unknown>>) {
  const store = rows.map((r) => ({ ...r }));
  const matches = (clause: unknown) => {
    const { sql, params } = queryFor(clause);
    return store.filter(
      (r) =>
        params.includes(r.id as string) &&
        (!sql.includes('user_id') || params.includes(r.userId as string))
    );
  };

  const selectWhere = vi.fn((clause: unknown) => Promise.resolve(matches(clause)));
  const txUpdate = vi.fn(() => ({
    set: (values: Record<string, unknown>) => ({
      where: async (clause: unknown) => {
        for (const r of matches(clause)) Object.assign(r, values);
      },
    }),
  }));
  const txDelete = vi.fn(() => ({
    where: async (clause: unknown) => {
      for (const r of matches(clause)) store.splice(store.indexOf(r), 1);
    },
  }));
  const db = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
      cb({ update: txUpdate, delete: txDelete })
    ),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);

  return { find: (id: string) => store.find((r) => r.id === id), size: () => store.length };
}

describe.each([
  ['mergeCompanies', mergeCompanies, companyRow] as const,
  ['mergeJobFitTags', mergeJobFitTags, tagRow] as const,
  ['mergeTechStackTags', mergeTechStackTags, tagRow] as const,
])('%s target/source overlap', (_name, merge, row) => {
  beforeEach(() => vi.clearAllMocks());

  const TARGET = '01HZ_MERGE_TARGET';
  const OTHER = '01HZ_MERGE_OTHER';
  const badRequest = { name: 'AppError', code: 'BAD_REQUEST', statusCode: 400 };

  // Untouched means byte-identical to what went in — not merely still present.
  // Exact equality is what covers both shapes with one assertion: the company
  // row carries the isDeleted flag the soft delete would flip, the tag rows do
  // not have that column at all because their delete is permanent.
  const untouched = (id: string) => row({ id, userId: CALLER });

  it('rejects a target that is its own only source, and leaves that row intact', async () => {
    const store = stubRowStore([row({ id: TARGET, userId: CALLER })]);

    await expect(merge([TARGET], TARGET, CALLER)).rejects.toMatchObject(badRequest);

    // The row itself is the assertion. Without the guard the company path marks
    // it isDeleted and returns 200; the tag paths remove it from the table.
    expect(store.find(TARGET)).toEqual(untouched(TARGET));
  });

  it('rejects a target listed alongside genuine sources, and merges nothing', async () => {
    // The realistic shape: a multi-select where the survivor is also ticked.
    const store = stubRowStore([
      row({ id: TARGET, userId: CALLER }),
      row({ id: OTHER, userId: CALLER }),
    ]);

    await expect(merge([OTHER, TARGET], TARGET, CALLER)).rejects.toMatchObject(badRequest);

    // All-or-nothing: the innocent source must not be folded in either.
    expect(store.size()).toBe(2);
    expect(store.find(TARGET)).toEqual(untouched(TARGET));
    expect(store.find(OTHER)).toEqual(untouched(OTHER));
  });

  it('rejects in single-user mode too, where no tenancy term narrows the delete', async () => {
    const store = stubRowStore([row({ id: TARGET, userId: CALLER })]);

    await expect(merge([TARGET], TARGET, undefined)).rejects.toMatchObject(badRequest);

    expect(store.find(TARGET)).toEqual(untouched(TARGET));
  });

  it('still merges when the target is not among the sources', async () => {
    // The guard must reject overlap only — this is the path that has to keep
    // working, and it is what tells an over-broad guard from a correct one.
    const store = stubRowStore([
      row({ id: TARGET, userId: CALLER }),
      row({ id: OTHER, userId: CALLER }),
    ]);

    const result = await merge([OTHER], TARGET, CALLER);

    expect(result.mergedCount).toBe(1);
    expect(store.find(TARGET)).toMatchObject({ version: 2 });
  });
});

// ── WIC-1373: tag PATCH + generate-diff tenancy ───────────────────────────────
// Same defect class as the merge scoping above, on the endpoints
// PATCH /api/catalog/tags/{job-fit,tech-stack}/:id and POST
// /api/catalog/generate-diff. The routes thread c.get('userId') through
// correctly; the services declared the parameter and never referenced it, so
// any authenticated caller holding a tag's ULID and its current version (1 for
// any tag never edited) could rename, recategorise or flip needsReview on
// another user's tag.

const OTHER_USER = '2c9e7f31-5a4b-4c8d-9e1f-6b3a8d2c4e70';

/**
 * A one-row db double that actually honours the where-clause, so a query the
 * service failed to scope finds the row exactly as Postgres would.
 *
 * Visibility rule, for the single row this holds: a predicate carrying no
 * user_id term matches it (that is the unscoped query the fix removes), and a
 * predicate carrying one matches only if the bound value is the row's owner.
 */
function stubOwnedRow(row: { userId: string }) {
  const visible = (clause: unknown) => {
    const { sql, params } = queryFor(clause);
    return !sql.includes('user_id') || params.includes(row.userId);
  };
  const selectWhere = vi.fn((clause: unknown) => Promise.resolve(visible(clause) ? [row] : []));
  const updateWhere = vi.fn((clause: unknown) => ({
    returning: () => Promise.resolve(visible(clause) ? [row] : []),
  }));
  const db = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { selectWhere, updateWhere };
}

describe('tag update tenancy scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  describe.each([
    ['updateJobFitTag', updateJobFitTag, 'JobFitTag'] as const,
    ['updateTechStackTag', updateTechStackTag, 'TechStackTag'] as const,
  ])('%s', (_name, update, resource) => {
    const patch = { displayName: 'Renamed', version: 1 };

    it('scopes both the read and the write to the caller', async () => {
      const { selectWhere, updateWhere } = stubDb([[tagRow()]], [[tagRow()]]);

      await update('01HZ_TAG_001', patch, CALLER);

      expectScopedTo(selectWhere.mock.calls[0][0], CALLER);
      // The update is a separate statement from the read, so an id-only
      // predicate here stays exploitable on its own even once the read is fixed.
      expect(updateWhere).toHaveBeenCalledTimes(1);
      expectScopedTo(updateWhere.mock.calls[0][0], CALLER);
      // ...and it must still carry the optimistic lock.
      expect(queryFor(updateWhere.mock.calls[0][0]).sql).toContain('"version" = $');
    });

    it("reports not found — not a version conflict — for another user's tag", async () => {
      // stubDb's `where` spy resolves its canned rows whatever predicate it is
      // handed, so it cannot express "the row exists but the caller may not see
      // it" — the case that matters here. stubOwnedRow honours the predicate.
      const { selectWhere } = stubOwnedRow(tagRow({ userId: OTHER_USER }));

      await expect(update('01HZ_TAG_001', patch, CALLER)).rejects.toThrow(
        new NotFoundError(resource)
      );
      // This is the exploit itself, not just a bad error message. The tag is on
      // version 1 (any tag never edited is), so the optimistic lock the caller
      // supplies matches and the unscoped write *succeeds* — reverting the fix
      // turns this case from a rejection into a completed rename.
      expectScopedTo(selectWhere.mock.calls[0][0], CALLER);
    });

    it('leaves both predicates unscoped in single-user mode', async () => {
      const { selectWhere, updateWhere } = stubDb([[tagRow()]], [[tagRow()]]);

      await update('01HZ_TAG_001', patch, undefined);

      expectUnscoped(selectWhere.mock.calls[0][0]);
      expectUnscoped(updateWhere.mock.calls[0][0]);
    });
  });
});

/** db double for generateDiff: select().from().where().orderBy().limit(). */
function stubDiffDb(rows: unknown[]) {
  const where = vi.fn();
  const orderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) });
  where.mockReturnValue({ orderBy });
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { selectWhere: where };
}

function diffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01HZ_DIFF_001',
    userId: CALLER,
    triggerSource: 'resume_upload',
    triggerId: '01HZ_RESUME_001',
    summary: '2 new entries',
    changes: [],
    pendingReview: [],
    status: 'approved',
    expiresAt: null,
    resolvedAt: new Date('2026-06-01T00:00:00.000Z'),
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('generateDiff tenancy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands the caller to processCatalogChange so the diff row is owned', async () => {
    // The owner is read off event.metadata.userId (the shape resume.service.ts
    // uses when it enqueues). Omitting it wrote catalog_diffs.user_id = null,
    // which no scoped reader — listDiffs, getDiff, applyDiff — can see again.
    stubDiffDb([diffRow()]);

    await generateDiff('resume', '01HZ_RESUME_001', CALLER);

    expect(processCatalogChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processCatalogChange).mock.calls[0][0]).toMatchObject({
      sourceType: 'resume',
      sourceId: '01HZ_RESUME_001',
      metadata: { userId: CALLER },
    });
  });

  it('scopes the lookup to the caller', async () => {
    // processCatalogChange bails early when the source yields no text, so the
    // row this call would otherwise have inserted need not exist — an unscoped
    // lookup then returns whichever diff is newest for that trigger id, which
    // for a foreign sourceId is the owner's.
    const { selectWhere } = stubDiffDb([diffRow()]);

    await generateDiff('resume', '01HZ_RESUME_001', CALLER);

    expectScopedTo(selectWhere.mock.calls[0][0], CALLER);
  });

  it('leaves the lookup unscoped in single-user mode', async () => {
    const { selectWhere } = stubDiffDb([diffRow()]);

    await generateDiff('resume', '01HZ_RESUME_001', undefined);

    expectUnscoped(selectWhere.mock.calls[0][0]);
    expect(vi.mocked(processCatalogChange).mock.calls[0][0]).toMatchObject({
      metadata: { userId: null },
    });
  });

  it('reports not found when no diff is visible to the caller', async () => {
    stubDiffDb([]);

    await expect(generateDiff('resume', '01HZ_RESUME_001', CALLER)).rejects.toThrow(
      new NotFoundError('CatalogDiff')
    );
  });
});
