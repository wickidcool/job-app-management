import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import {
  mergeCompanies,
  mergeJobFitTags,
  mergeTechStackTags,
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
function stubDb(selectResults: unknown[][]) {
  const where = vi.fn();
  for (const rows of selectResults) where.mockResolvedValueOnce(rows);

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
    transaction,
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);

  return {
    selectWhere: where,
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

  // ── first_seen_at retention ────────────────────────────────────────────────
  //
  // KNOWN GAP (WIC-1360). Merging is meant to preserve the earliest sighting of
  // a company — that date is what the catalog reports as `firstSeen`, and it is
  // the only record that the older duplicate ever existed. mergeCompanies never
  // writes firstSeenAt, so it silently keeps the *target's* date. Merging an old
  // duplicate into a newer survivor moves the company's first-seen date forward
  // in time and the history is unrecoverable.

  it.fails('keeps the earliest firstSeenAt when an older duplicate is merged in', async () => {
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

  it('gap sentinel: the merge update payload does not mention firstSeenAt today', async () => {
    const { txSet } = stubDb([[companyRow()], [companyRow({ id: '01HZ_CO_002' })], [companyRow()]]);

    await mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001');

    expect(txSet.mock.calls[0][0]).not.toHaveProperty('firstSeenAt');
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
