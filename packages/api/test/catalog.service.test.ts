import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/services/extraction.service.js', () => ({
  processCatalogChange: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '../src/db/client.js';
import { processCatalogChange } from '../src/services/extraction.service.js';
import type { ListDiffsOptions } from '../src/services/catalog.service.js';
import {
  generateDiff,
  listBullets,
  listCompanies,
  listDiffs,
  listJobFitTags,
  listStarEntries,
  listTechStackTags,
  listThemes,
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

// ── WIC-1407: listDiffs tenancy ───────────────────────────────────────────────
// GET /api/catalog/diffs already scopes to the caller in the service, but
// nothing pinned it: deleting `eq(catalogDiffs.userId, userId)` from listDiffs
// left this file and catalog.routes.test.ts at 80/80 green, so a regression
// that lets any caller page another user's diffs would ship unnoticed.
//
// The predicate is a compound — tenancy AND status — and the assertions below
// match the whole rendered clause rather than one conjunct. Asserting a single
// half is what let four mutations survive in WIC-1378, and `params` alone never
// says which *column* a value was bound to; pinning the exact SQL alongside the
// exact params does, by position.

/** db double for a paged list: select().from().where().orderBy().limit().offset(). */
function stubPagedListDb(rows: unknown[]) {
  const where = vi.fn();
  const offset = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset }) });
  where.mockReturnValue({ orderBy });
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { selectWhere: where };
}

/** As stubPagedListDb, but the page actually honours the where-clause. */
function stubPagedOwnedRow(row: { userId: string }) {
  const offset = vi.fn();
  const where = vi.fn((clause: unknown) => {
    const { sql, params } = queryFor(clause);
    const visible = !sql.includes('user_id') || params.includes(row.userId);
    offset.mockResolvedValueOnce(visible ? [row] : []);
    return { orderBy: () => ({ limit: () => ({ offset }) }) };
  });
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { selectWhere: where };
}

const SCOPED_DIFF_CLAUSE = '("catalog_diffs"."user_id" = $1 and "catalog_diffs"."status" = $2)';

describe('listDiffs tenancy', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['the default pending filter', {} as ListDiffsOptions, 'pending'],
    ['an explicit status filter', { status: 'approved' } as ListDiffsOptions, 'approved'],
  ])('scopes the page to the caller alongside %s', async (_name, opts, status) => {
    const { selectWhere } = stubPagedListDb([]);

    await listDiffs(opts, CALLER);

    // Both conjuncts, table-qualified, with each value pinned to the column
    // that binds it: $1 is the tenancy term, $2 the status term. A mutation
    // that drops either half — or swaps which column a value lands on —
    // changes one of these two lines.
    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(SCOPED_DIFF_CLAUSE);
    expect(params).toEqual([CALLER, status]);
  });

  it('binds the caller it was handed, not a fixed owner', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await listDiffs({}, OTHER_USER);

    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(SCOPED_DIFF_CLAUSE);
    expect(params).toEqual([OTHER_USER, 'pending']);
  });

  it('leaves the page unscoped in single-user mode', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await listDiffs({}, undefined);

    // No tenancy term — and the status half survives its removal, which a bare
    // `not.toContain('user_id')` would not have shown.
    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe('"catalog_diffs"."status" = $1');
    expect(params).toEqual(['pending']);
  });

  it("does not page another user's diffs", async () => {
    // The exploit itself, not just the shape of the SQL: stubPagedListDb
    // resolves its canned rows whatever predicate it is handed, so only a
    // double that honours the clause can show that dropping the tenancy term
    // makes a foreign diff readable.
    const { selectWhere } = stubPagedOwnedRow(diffRow({ userId: OTHER_USER, status: 'pending' }));

    const { diffs } = await listDiffs({}, CALLER);

    expect(diffs).toEqual([]);
    expect(selectWhere).toHaveBeenCalledTimes(1);
  });

  it("does page the caller's own diffs", async () => {
    // Positive direction. Without this, stubPagedOwnedRow's
    // `params.includes(row.userId)` term is dead code: a double that returned
    // [] unconditionally would satisfy the negative test above vacuously.
    const row = diffRow({ userId: CALLER, status: 'pending' });
    stubPagedOwnedRow(row);

    const { diffs } = await listDiffs({}, CALLER);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ id: row.id });
  });
});

// ── WIC-1418: the remaining catalog list* tenancy predicates ─────────────────
// Same defect class as WIC-1378 / WIC-1380 / WIC-1407, six more instances.
// Measured on this tree (baseline 540 passed / 24 files): deleting the
// `if (userId) conditions.push(eq(<table>.userId, userId))` line from any one of
// listCompanies, listJobFitTags, listTechStackTags, listBullets, listThemes —
// or the `.where(userId ? ... : undefined)` in listStarEntries — left the whole
// @wic/api suite green. Every one of the six is reachable: catalog.routes.ts
// wires them at :192, :230, :249, :315, :320 and :328 respectively, each passing
// `c.get('userId')`, so a regression on any of them is a cross-tenant read of
// another user's catalog page.
//
// (The originating card listed the last two as `listQuantifiedBullets` /
// `listRecurringThemes` and called them unrouted. Neither name exists; the real
// functions are `listBullets` / `listThemes` and both are routed. `listStarEntries`
// is a sixth instance the card did not enumerate.)
//
// Three rules carried over from the earlier cards, all load-bearing here:
//   1. Assert the WHOLE rendered clause with `toBe`. These predicates are
//      compound, and pinning only the tenancy conjunct is what let four
//      mutations survive in WIC-1378.
//   2. Assert the exact `params` with `toEqual`, so each value is pinned to the
//      column that binds it *by position*. `params.toContain(userId)` never says
//      which column filtered — an `eq(<table>.id, userId)` mutation keeps the
//      params identical and only moves the column name in the SQL.
//   3. Use the table-qualified column name. The in-file `expectScopedTo` helper
//      matches the unqualified `"user_id"` substring and is cross-table-blind
//      (a known WIC-1378 finding), so these assert exact SQL instead of reusing it.
//
// Both directions share one option set per case, so the only difference between
// `scopedSql` and `unscopedSql` is the tenancy term itself — which also pins that
// the *other* conjuncts survive its removal in single-user mode.

function bulletRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01HZ_BULLET_001',
    userId: CALLER,
    sourceType: 'resume',
    sourceId: '01HZ_RESUME_001',
    rawText: 'Cut p95 checkout latency by 38%',
    actionVerb: 'Cut',
    metricType: 'percentage',
    metricValue: '38',
    isApproximate: false,
    secondaryMetricType: null,
    secondaryMetricValue: null,
    impactCategory: 'performance',
    extractedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function themeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01HZ_THEME_001',
    userId: CALLER,
    themeSlug: 'platform-migration',
    displayName: 'Platform migration',
    occurrenceCount: 4,
    sourceIds: ['01HZ_RESUME_001'],
    exampleExcerpts: [] as string[],
    isCoreStrength: true,
    isHistorical: false,
    lastSeenAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface PagedTenancyCase {
  /** Service under test, invoked with one fixed option set and a varying caller. */
  run: (userId?: string) => Promise<Record<string, unknown>>;
  /** Key the page comes back under, e.g. `companies`. */
  itemsKey: string;
  /** Whole rendered clause when a caller is supplied; $1 is always the tenancy term. */
  scopedSql: string;
  /** Params after $1 — the surviving conjuncts, in bind order. */
  scopedTail: unknown[];
  /** Whole rendered clause in single-user mode, and its params. */
  unscopedSql: string;
  unscopedParams: unknown[];
  /** A row owned by `userId`, shaped for this function's DTO mapper. */
  ownedRow: (userId: string) => { userId: string; id: string };
}

const PAGED_TENANCY_CASES: Record<string, PagedTenancyCase> = {
  listCompanies: {
    run: (userId) => listCompanies({}, userId),
    itemsKey: 'companies',
    scopedSql: '("company_catalog"."user_id" = $1 and "company_catalog"."is_deleted" = $2)',
    scopedTail: [false],
    unscopedSql: '"company_catalog"."is_deleted" = $1',
    unscopedParams: [false],
    ownedRow: (userId) => companyRow({ userId }) as { userId: string; id: string },
  },
  listJobFitTags: {
    run: (userId) =>
      listJobFitTags({ category: 'industry', needsReview: true, search: 'x' }, userId),
    itemsKey: 'tags',
    scopedSql:
      '("job_fit_tags"."user_id" = $1 and "job_fit_tags"."category" = $2 and ' +
      '"job_fit_tags"."needs_review" = $3 and "job_fit_tags"."display_name" ilike $4)',
    scopedTail: ['industry', true, '%x%'],
    unscopedSql:
      '("job_fit_tags"."category" = $1 and "job_fit_tags"."needs_review" = $2 and ' +
      '"job_fit_tags"."display_name" ilike $3)',
    unscopedParams: ['industry', true, '%x%'],
    ownedRow: (userId) => tagRow({ userId }) as { userId: string; id: string },
  },
  listTechStackTags: {
    run: (userId) => listTechStackTags({ category: 'language', needsReview: true }, userId),
    itemsKey: 'tags',
    scopedSql:
      '("tech_stack_tags"."user_id" = $1 and "tech_stack_tags"."category" = $2 and ' +
      '"tech_stack_tags"."needs_review" = $3)',
    scopedTail: ['language', true],
    unscopedSql: '("tech_stack_tags"."category" = $1 and "tech_stack_tags"."needs_review" = $2)',
    unscopedParams: ['language', true],
    ownedRow: (userId) =>
      tagRow({ userId, category: 'language' }) as { userId: string; id: string },
  },
  listBullets: {
    run: (userId) => listBullets({ impactCategory: 'revenue', sourceId: 'S1' }, userId),
    itemsKey: 'bullets',
    scopedSql:
      '("quantified_bullets"."user_id" = $1 and "quantified_bullets"."impact_category" = $2 and ' +
      '"quantified_bullets"."source_id" = $3)',
    scopedTail: ['revenue', 'S1'],
    unscopedSql:
      '("quantified_bullets"."impact_category" = $1 and "quantified_bullets"."source_id" = $2)',
    unscopedParams: ['revenue', 'S1'],
    ownedRow: (userId) => bulletRow({ userId }) as { userId: string; id: string },
  },
  listThemes: {
    run: (userId) => listThemes({ coreOnly: true }, userId),
    itemsKey: 'themes',
    scopedSql:
      '("recurring_themes"."user_id" = $1 and "recurring_themes"."is_core_strength" = $2 and ' +
      '"recurring_themes"."is_historical" = $3)',
    scopedTail: [true, false],
    unscopedSql:
      '("recurring_themes"."is_core_strength" = $1 and "recurring_themes"."is_historical" = $2)',
    unscopedParams: [true, false],
    ownedRow: (userId) => themeRow({ userId }) as { userId: string; id: string },
  },
};

describe.each(Object.entries(PAGED_TENANCY_CASES))('%s tenancy', (_fn, tc) => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes the page to the caller alongside every other filter', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await tc.run(CALLER);

    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(tc.scopedSql);
    expect(params).toEqual([CALLER, ...tc.scopedTail]);
  });

  it('binds the caller it was handed, not a fixed owner', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await tc.run(OTHER_USER);

    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(tc.scopedSql);
    expect(params).toEqual([OTHER_USER, ...tc.scopedTail]);
  });

  it('leaves the page unscoped in single-user mode, other filters intact', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await tc.run(undefined);

    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(tc.unscopedSql);
    expect(params).toEqual(tc.unscopedParams);
  });

  it("does not page another user's rows", async () => {
    // The exploit itself, not just the shape of the SQL: stubPagedListDb resolves
    // its canned rows whatever predicate it is handed, so only a double that
    // honours the clause shows that dropping the tenancy term makes a foreign
    // row readable.
    const { selectWhere } = stubPagedOwnedRow(tc.ownedRow(OTHER_USER));

    const page = await tc.run(CALLER);

    expect(page[tc.itemsKey]).toEqual([]);
    expect(selectWhere).toHaveBeenCalledTimes(1);
  });

  it("does page the caller's own rows", async () => {
    // Positive direction — keeps the negative test above from passing vacuously
    // against an always-empty harness.
    const row = tc.ownedRow(CALLER);
    stubPagedOwnedRow(row);

    const page = await tc.run(CALLER);

    expect(page[tc.itemsKey]).toHaveLength(1);
    expect((page[tc.itemsKey] as { id: string }[])[0]).toMatchObject({ id: row.id });
  });
});

// listStarEntries takes no options and has a shorter chain — select().from()
// .where().orderBy() with no limit/offset — so it needs its own doubles. Its
// tenancy term is also the *only* predicate, which means single-user mode passes
// `undefined` to .where() rather than a narrowed clause.

/** db double for listStarEntries: select().from().where().orderBy(). */
function stubStarEntriesDb(rows: unknown[]) {
  const where = vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) });
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { selectWhere: where };
}

/** As stubStarEntriesDb, but the read actually honours the where-clause. */
function stubStarEntriesOwnedRow(row: { userId: string }) {
  const where = vi.fn((clause: unknown) => {
    const visible =
      clause === undefined ||
      (() => {
        const { sql, params } = queryFor(clause);
        return !sql.includes('user_id') || params.includes(row.userId);
      })();
    return { orderBy: vi.fn().mockResolvedValue(visible ? [row] : []) };
  });
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { selectWhere: where };
}

describe('listStarEntries tenancy', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['the caller', () => CALLER],
    ['a different caller', () => OTHER_USER],
  ])('scopes the STAR read to %s', async (_name, who) => {
    const { selectWhere } = stubStarEntriesDb([]);

    await listStarEntries(who());

    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe('"quantified_bullets"."user_id" = $1');
    expect(params).toEqual([who()]);
  });

  it('passes no predicate at all in single-user mode', async () => {
    const { selectWhere } = stubStarEntriesDb([]);

    await listStarEntries(undefined);

    // Not a narrowed clause — literally `.where(undefined)`, since tenancy is
    // this query's only filter.
    expect(selectWhere).toHaveBeenCalledTimes(1);
    expect(selectWhere.mock.calls[0][0]).toBeUndefined();
  });

  it("does not return another user's STAR entries", async () => {
    stubStarEntriesOwnedRow(bulletRow({ userId: OTHER_USER }));

    expect(await listStarEntries(CALLER)).toEqual([]);
  });

  it("does return the caller's own STAR entries", async () => {
    const row = bulletRow({ userId: CALLER });
    stubStarEntriesOwnedRow(row);

    const entries = await listStarEntries(CALLER);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: row.id });
  });
});
