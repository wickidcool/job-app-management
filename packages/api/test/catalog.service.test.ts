import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/services/extraction.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/extraction.service.js')>()),
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
import { scopedReadStub } from './helpers/scoped-read-stub.js';

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

/**
 * The clause filters `table` on user_id bound to this exact caller, AND still
 * carries every id it is supposed to.
 *
 * Both halves matter, and asserting only the tenancy half lets real mutations
 * through:
 *  - drop the id term from the company source predicate and the soft-delete
 *    retires *every* company the caller owns — a tenancy-only assertion calls
 *    that correctly scoped;
 *  - an unqualified `"user_id"` substring matches a predicate built from the
 *    wrong table's column, because the rendered SQL is table-qualified
 *    (`"company_catalog"."user_id" = $2`);
 *  - reusing the target predicate for the source read merges the target into
 *    itself, and every term in it is still perfectly scoped.
 *
 * `ids` is required rather than variadic on purpose: an optional rest parameter
 * lets a future call site omit it and silently get the one-sided check back.
 */
function expectScopedTo(clause: unknown, userId: string, table: string, ids: string[]) {
  const { sql, params } = queryFor(clause);
  expect(sql).toContain(`"${table}"."user_id" = $`);
  expect(params).toContain(userId);
  expectIds(sql, params, table, ids);
}

/**
 * The clause STILL carries a tenancy term when the owner is absent (WIC-1638).
 *
 * This replaces the old `expectUnscoped`, which asserted the opposite — that an
 * absent owner dropped the `user_id` term and left a bare id match. That was the
 * documented "single-user mode" posture, and it is exactly the fail-open shape
 * ADR-010 D2 retires: a caller who reached these services with no resolved owner
 * (a `sub`-less JWT, per WIC-1554) got an unscoped read and an unscoped delete.
 *
 * The owner is now `userId: string`, so absence is a type error at every real
 * call site and is rejected once at the route edge by `requireOwner`. These
 * tests smuggle `undefined` past the type deliberately, to pin the runtime
 * behaviour of the predicate itself rather than trusting the compiler.
 *
 * Drizzle renders `eq(col, undefined)` as a real `"t"."user_id" = $n` term and
 * binds the absent value through as a parameter. Every `user_id` in these tables
 * is a non-null uuid (migration `0017` rewrote the NULLs to the sentinel and set
 * NOT NULL), so an equality against an absent value cannot match any stored row
 * — the operation fails closed rather than reading or deleting across tenants.
 *
 * Asserting the term is *present, and bound to something no row can equal* is
 * what kills the mutant that restores `userId ? and(id, owner) : eq(id)`: under
 * that mutation the term disappears entirely and the id match runs unscoped.
 */
function expectFailsClosedOnAbsentOwner(clause: unknown, table: string, ids: string[]) {
  const { sql, params } = queryFor(clause);
  expect(sql).toContain(`"${table}"."user_id" = $`);
  // The bound owner is the absent one, not some real tenant's id.
  expect(params).toContain(undefined);
  expect(params).not.toContain(CALLER);
  expectIds(sql, params, table, ids);
}

/**
 * The clause keys on `table`.id and binds exactly the ids named. The column
 * check is what stops `eq(table.normalizedName, targetId)` from passing: a bare
 * `params` check only proves the value reached the query, not which column it
 * filtered.
 *
 * Two renderings are legal, because the target and the sources are built by
 * different Drizzle operators:
 *  - the single target is `eq(t.id, targetId)`   -> `"t"."id" = $1`
 *  - the source set is `inArray(t.id, sourceIds)` -> `"t"."id" in ($1, $2)`
 *
 * Accepting both is required, not lax. WIC-1377 replaced a raw
 * ``sql`${t.id} = ANY(${sourceIds})` `` — which Drizzle renders as the row
 * constructor `"t"."id" = ANY(($1, $2))` and Postgres rejects outright — with
 * `inArray`. Asserting the bare prefix `"t"."id" = ` therefore encodes the
 * *defect* as the expectation: it matches the broken `= ANY((...))` form and
 * fails against the fix. Both accepted forms stay table-qualified, so the
 * wrong-column check above survives.
 */
function expectIds(sql: string, params: unknown[], table: string, ids: string[]) {
  const col = `"${table}"."id"`;
  expect(sql).toMatch(new RegExp(`${col.replace(/[".]/g, '\\$&')}\\s+(?:=\\s+\\$\\d+|in\\s+\\()`));
  for (const id of ids) expect(params).toContain(id);
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
// The first fix mirrored `resolveDiffItem`: scope on userId when there is one,
// and leave the predicate alone when there is not, so single-user/local mode
// (SUPABASE_JWT_SECRET unset -> userId null) kept working unchanged.
//
// WIC-1638 retires that second half. The owner-absent branch was not serving
// local dev so much as preserving a cross-tenant fallback for any caller who
// arrived without a resolved owner — including a JWT that verifies but carries
// no `sub` claim (WIC-1554). Per ADR-010 D2 the owner is now required
// (`userId: string`), absence is rejected once at the route edge by
// `requireOwner`, and local dev gets a real owner rather than an absence (D3).
//
// These tests assert on the rendered SQL rather than on call counts, so removing
// the tenancy term fails them.

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

/**
 * An owner that is absent at run time despite the `userId: string` signature.
 *
 * The cast is the point of the test, not a shortcut around it: `requireOwner`
 * makes this unreachable through the routes, but the services are exported and
 * `middleware/auth.ts` can still resolve `userId` to `null` (WIC-1554). These
 * tests pin what the predicate does if one ever arrives, rather than relying on
 * the compiler to prove it cannot.
 */
const ABSENT_OWNER = undefined as unknown as string;

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
      expectScopedTo(selectWhere.mock.calls[0][0], CALLER, 'company_catalog', ['01HZ_CO_001']);
      expectScopedTo(selectWhere.mock.calls[1][0], CALLER, 'company_catalog', ['01HZ_CO_002']);
      // Writes: fold into the target, then soft-delete the sources. The second
      // one is the destructive half — an id-only predicate there would retire
      // another user's rows even if the read above excluded them, and a
      // *tenancy-only* predicate there would retire every row the caller owns.
      expect(txUpdateWhere).toHaveBeenCalledTimes(2);
      expectScopedTo(txUpdateWhere.mock.calls[0][0], CALLER, 'company_catalog', ['01HZ_CO_001']);
      expectScopedTo(txUpdateWhere.mock.calls[1][0], CALLER, 'company_catalog', ['01HZ_CO_002']);
    });

    it('reports the target as not found when it belongs to another user', async () => {
      // The scoped read returns nothing even though the row exists.
      stubDb([[]]);

      await expect(mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001', CALLER)).rejects.toThrow(
        NotFoundError
      );
    });

    it('keeps every predicate scoped when the owner is absent, so nothing matches', async () => {
      const { selectWhere, txUpdateWhere } = stubDb([
        [companyRow()],
        [companyRow({ id: '01HZ_CO_002' })],
        [companyRow()],
      ]);

      await mergeCompanies(['01HZ_CO_002'], '01HZ_CO_001', ABSENT_OWNER);

      // Reads and writes alike keep the tenancy term. Before WIC-1638 all four
      // of these lost it, so an owner-less merge folded and soft-deleted rows
      // across every tenant.
      expectFailsClosedOnAbsentOwner(selectWhere.mock.calls[0][0], 'company_catalog', [
        '01HZ_CO_001',
      ]);
      expectFailsClosedOnAbsentOwner(selectWhere.mock.calls[1][0], 'company_catalog', [
        '01HZ_CO_002',
      ]);
      expectFailsClosedOnAbsentOwner(txUpdateWhere.mock.calls[0][0], 'company_catalog', [
        '01HZ_CO_001',
      ]);
      expectFailsClosedOnAbsentOwner(txUpdateWhere.mock.calls[1][0], 'company_catalog', [
        '01HZ_CO_002',
      ]);
    });
  });

  describe.each([
    ['mergeJobFitTags', mergeJobFitTags, 'job_fit_tags'],
    ['mergeTechStackTags', mergeTechStackTags, 'tech_stack_tags'],
  ] as const)('%s', (_name, merge, table) => {
    it('scopes the target read, the source read, the update and the delete', async () => {
      const { selectWhere, txUpdateWhere, txDeleteWhere } = stubDb([
        [tagRow()],
        [tagRow({ id: '01HZ_TAG_002' })],
        [tagRow()],
      ]);

      await merge(['01HZ_TAG_002'], '01HZ_TAG_001', CALLER);

      expectScopedTo(selectWhere.mock.calls[0][0], CALLER, table, ['01HZ_TAG_001']);
      expectScopedTo(selectWhere.mock.calls[1][0], CALLER, table, ['01HZ_TAG_002']);
      expectScopedTo(txUpdateWhere.mock.calls[0][0], CALLER, table, ['01HZ_TAG_001']);
      // The delete is unrecoverable — there is no soft-delete for tags.
      expect(txDeleteWhere).toHaveBeenCalledTimes(1);
      expectScopedTo(txDeleteWhere.mock.calls[0][0], CALLER, table, ['01HZ_TAG_002']);
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

    it('keeps every predicate scoped when the owner is absent, so nothing matches', async () => {
      const { selectWhere, txUpdateWhere, txDeleteWhere } = stubDb([
        [tagRow()],
        [tagRow({ id: '01HZ_TAG_002' })],
        [tagRow()],
      ]);

      await merge(['01HZ_TAG_002'], '01HZ_TAG_001', ABSENT_OWNER);

      expectFailsClosedOnAbsentOwner(selectWhere.mock.calls[0][0], table, ['01HZ_TAG_001']);
      expectFailsClosedOnAbsentOwner(selectWhere.mock.calls[1][0], table, ['01HZ_TAG_002']);
      expectFailsClosedOnAbsentOwner(txUpdateWhere.mock.calls[0][0], table, ['01HZ_TAG_001']);
      // The delete is the unrecoverable one — tags have no soft-delete. Before
      // WIC-1638 an owner-less merge hard-deleted by bare id.
      expectFailsClosedOnAbsentOwner(txDeleteWhere.mock.calls[0][0], table, ['01HZ_TAG_002']);
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
  async function sourceRead(sourceIds: string[], userId: string) {
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

  it('renders an IN list, still scoped, when the owner is absent', async () => {
    // WIC-1638: this used to render a bare `"t"."id" in ($1, $2)` — the tenancy
    // term was dropped entirely, so an owner-less merge selected sources across
    // every tenant. The term is now unconditional and binds null, which matches
    // nothing.
    const { sql, params } = await sourceRead(['A', 'B'], ABSENT_OWNER);

    expect(sql).toBe(`("${table}"."id" in ($1, $2) and "${table}"."user_id" = $3)`);
    expect(params).toEqual(['A', 'B', undefined]);
  });

  it('never emits ANY(( with or without an owner', async () => {
    for (const ids of [['A', 'B'], ['A']]) {
      for (const caller of [CALLER, ABSENT_OWNER]) {
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

  it('leaves a foreign-owned row alone while merging', async () => {
    // Pins the second half of stubRowStore's documented visibility rule. Without
    // this case the tenancy term in `matches` is dead weight — no other test
    // puts a row the caller does not own into the store, so a double that
    // matched on bare id membership, or an update that ignored its where-clause
    // entirely, passed every one of them. Both mutants fail here.
    const FOREIGN = '01HZ_MERGE_FOREIGN';
    const store = stubRowStore([
      row({ id: TARGET, userId: CALLER }),
      row({ id: OTHER, userId: CALLER }),
      row({ id: FOREIGN, userId: OTHER_USER }),
    ]);

    const result = await merge([OTHER, FOREIGN], TARGET, CALLER);

    // The scoped source read never sees the foreign row, so it is not counted…
    expect(result.mergedCount).toBe(1);
    // …and the scoped writes never reach it either.
    expect(store.find(FOREIGN)).toEqual(row({ id: FOREIGN, userId: OTHER_USER }));
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
    ['updateJobFitTag', updateJobFitTag, 'JobFitTag', 'job_fit_tags'] as const,
    ['updateTechStackTag', updateTechStackTag, 'TechStackTag', 'tech_stack_tags'] as const,
  ])('%s', (_name, update, resource, table) => {
    const patch = { displayName: 'Renamed', version: 1 };

    it('scopes both the read and the write to the caller', async () => {
      const { selectWhere, updateWhere } = stubDb([[tagRow()]], [[tagRow()]]);

      await update('01HZ_TAG_001', patch, CALLER);

      expectScopedTo(selectWhere.mock.calls[0][0], CALLER, table, ['01HZ_TAG_001']);
      // The update is a separate statement from the read, so an id-only
      // predicate here stays exploitable on its own even once the read is fixed.
      expect(updateWhere).toHaveBeenCalledTimes(1);
      expectScopedTo(updateWhere.mock.calls[0][0], CALLER, table, ['01HZ_TAG_001']);
      // ...and it must still carry the optimistic lock. Qualified, for the same
      // reason expectIds qualifies its columns: a bare `"version"` substring
      // would match a term built from any table's version column.
      expect(queryFor(updateWhere.mock.calls[0][0]).sql).toContain(`"${table}"."version" = $`);
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
      expectScopedTo(selectWhere.mock.calls[0][0], CALLER, table, ['01HZ_TAG_001']);
    });

    it('keeps both predicates scoped when the owner is absent, so nothing matches', async () => {
      const { selectWhere, updateWhere } = stubDb([[tagRow()]], [[tagRow()]]);

      await update('01HZ_TAG_001', patch, ABSENT_OWNER);

      expectFailsClosedOnAbsentOwner(selectWhere.mock.calls[0][0], table, ['01HZ_TAG_001']);
      expectFailsClosedOnAbsentOwner(updateWhere.mock.calls[0][0], table, ['01HZ_TAG_001']);
    });
  });
});

/**
 * db double for generateDiff.
 *
 * Two selects now share this `where` spy, in this order:
 *   0. the source-ownership probe — `select().from().where()`, awaited directly;
 *   1. the diff lookup — `select().from().where().orderBy().limit()`.
 *
 * So `where` returns an object that is both chainable *and* thenable. The
 * ownership probe is skipped entirely in single-user mode (`userId` undefined),
 * which is why the assertions below index the diff lookup by
 * `DIFF_LOOKUP_CALL` / `0` rather than assuming a fixed position.
 *
 * @param owned rows the ownership probe resolves; `[]` means the caller does
 *   not own the source, which is the AC-1 case.
 */
function stubDiffDb(rows: unknown[], owned: unknown[] = [{ id: '01HZ_RESUME_001' }]) {
  const where = vi.fn();
  const orderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) });
  where.mockReturnValue({
    orderBy,
    then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(owned).then(resolve, reject),
  });
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { selectWhere: where };
}

/** Index of the diff lookup's `.where()` once the ownership probe precedes it. */
const DIFF_LOOKUP_CALL = 1;

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

/**
 * generateDiff's lookup keys on trigger_source + trigger_id, never on a diff id,
 * so expectScopedTo / expectFailsClosedOnAbsentOwner do not apply here —
 * expectIds would demand a `"catalog_diffs"."id" = ` term this predicate is not
 * supposed to carry. Assert the same two halves explicitly rather than
 * reintroducing an optional `ids`, which is exactly the one-sided escape hatch
 * those helpers refuse.
 *
 * `userId` is required: the tenancy term is now unconditional (WIC-1638), so
 * there is no caller that legitimately expects it to be absent. Pass `undefined`
 * to assert the owner-absent case, where the term is present but binds a value
 * no stored row can equal.
 */
function expectDiffLookup(
  clause: unknown,
  opts: { userId: string | undefined; triggerId: string }
) {
  const { sql, params } = queryFor(clause);
  expect(sql).toContain('"catalog_diffs"."trigger_source" = $');
  expect(sql).toContain('"catalog_diffs"."trigger_id" = $');
  expect(params).toContain(opts.triggerId);
  expect(sql).toContain('"catalog_diffs"."user_id" = $');
  expect(params).toContain(opts.userId);
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

    expectDiffLookup(selectWhere.mock.calls[DIFF_LOOKUP_CALL][0], {
      userId: CALLER,
      triggerId: '01HZ_RESUME_001',
    });
  });

  it('keeps the lookup scoped when the owner is absent, so nothing matches', async () => {
    const { selectWhere } = stubDiffDb([diffRow()]);

    await generateDiff('resume', '01HZ_RESUME_001', ABSENT_OWNER);

    // WIC-1638: the `if (userId)` guard around this term is gone, so the lookup
    // can no longer fall through to whichever diff is newest for the trigger id
    // regardless of owner.
    //
    // ADR-010 D2 (WIC-2068) removed the `if (userId)` around the *ownership
    // probe* above it too, so that read now happens on this path as well — which
    // is why the lookup sits at DIFF_LOOKUP_CALL here, exactly where it does for
    // a real caller, rather than shifting up to index 0. stubDiffDb answers every
    // select with its canned rows, so the probe is satisfied and the call
    // proceeds; the fail-closed behaviour against a stub that honours the clause
    // is asserted in the ownership-probe block below.
    expectDiffLookup(selectWhere.mock.calls[DIFF_LOOKUP_CALL][0], {
      userId: undefined,
      triggerId: '01HZ_RESUME_001',
    });
    expect(vi.mocked(processCatalogChange).mock.calls[0][0]).toMatchObject({
      metadata: { userId: undefined },
    });
  });

  it('reports not found when no diff is visible to the caller', async () => {
    stubDiffDb([]);

    await expect(generateDiff('resume', '01HZ_RESUME_001', CALLER)).rejects.toThrow(
      new NotFoundError('CatalogDiff')
    );
  });
});

/**
 * WIC-1414 — the ownership decision at the entry point itself.
 *
 * The block above pins the *diff lookup* predicate. It cannot see this defect,
 * because the leak happens strictly earlier: `processCatalogChange` reads the
 * source row by id alone (`getTextContent`, extraction.service.ts — no userId
 * parameter on `main` at cfbd3a6), extracts the owner's text, and auto-applies
 * it into the **caller's** catalog. By the time the scoped lookup runs, the
 * write has already happened and it finds the caller's own fresh row, so a
 * lookup-only assertion reports success on a call that just exfiltrated.
 *
 * So these drive the observable the lookup tests cannot: whether
 * `processCatalogChange` is reachable at all for a foreign sourceId.
 * `scopedReadStub` evaluates the real drizzle clause against the fixtures, so
 * dropping the `user_id` term admits the foreign row and the guard goes quiet —
 * which is the mutation these are written to kill.
 */
describe('generateDiff source ownership (WIC-1414)', () => {
  const RESUME = '01HZ_RESUME_OWNED_BY_OTHER';
  const APP = '01HZ_APP_OWNED_BY_OTHER';

  beforeEach(() => vi.clearAllMocks());

  /** Fixtures where the named source belongs to OTHER_USER, not CALLER. */
  function foreignSources() {
    return scopedReadStub({
      resumes: [{ id: RESUME, userId: OTHER_USER }],
      applications: [{ id: APP, userId: OTHER_USER }],
      catalog_diffs: [],
    });
  }

  it('AC-1: refuses a resume the caller does not own, before any extraction', async () => {
    const stub = foreignSources();
    vi.mocked(getDb).mockReturnValue(stub.db as unknown as ReturnType<typeof getDb>);

    await expect(generateDiff('resume', RESUME, CALLER)).rejects.toThrow(
      new NotFoundError('Resume')
    );

    // The whole point: the extraction that would read and auto-apply the
    // owner's text never runs. Asserting only on the thrown error would pass
    // just as well with the leak intact and a 404 issued afterwards.
    expect(processCatalogChange).not.toHaveBeenCalled();
    expect(stub.opsOn('catalog_diffs')).toHaveLength(0);
  });

  it('AC-1: refuses an application the caller does not own, before any extraction', async () => {
    const stub = foreignSources();
    vi.mocked(getDb).mockReturnValue(stub.db as unknown as ReturnType<typeof getDb>);

    await expect(generateDiff('application', APP, CALLER)).rejects.toThrow(
      new NotFoundError('Application')
    );

    expect(processCatalogChange).not.toHaveBeenCalled();
    expect(stub.opsOn('catalog_diffs')).toHaveLength(0);
  });

  it('scopes the ownership probe by id AND owner', async () => {
    const stub = foreignSources();
    vi.mocked(getDb).mockReturnValue(stub.db as unknown as ReturnType<typeof getDb>);

    await expect(generateDiff('resume', RESUME, CALLER)).rejects.toThrow(NotFoundError);

    // Structural half: an id-only probe would resolve the foreign row and let
    // the call through, so the owner term is the reason the read comes back
    // empty — not an accident of the fixture set.
    const { sql, params } = queryFor(stub.clausesOn('resumes')[0]);
    expect(sql).toContain('"resumes"."id" = $');
    expect(sql).toContain('"resumes"."user_id" = $');
    expect(params).toContain(RESUME);
    expect(params).toContain(CALLER);
    expect(params).not.toContain(OTHER_USER);
  });

  it('AC-2: the owner’s own call proceeds unchanged', async () => {
    const stub = scopedReadStub({
      resumes: [{ id: RESUME, userId: CALLER }],
      // camelCase keys — `readColumn` resolves a rendered `trigger_id` to
      // `triggerId` first, so diffRow()'s own camelCase fields would otherwise
      // shadow any snake_case override and the fixture would never match.
      catalog_diffs: [{ ...diffRow(), triggerId: RESUME, userId: CALLER, id: '01HZ_DIFF_OK' }],
    });
    vi.mocked(getDb).mockReturnValue(stub.db as unknown as ReturnType<typeof getDb>);

    const result = await generateDiff('resume', RESUME, CALLER);

    expect(processCatalogChange).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('01HZ_DIFF_OK');
  });

  it('ADR-010 D2: an absent owner is refused at the probe, not waved past it', async () => {
    // This replaces 'skips the probe in single-user mode rather than failing
    // closed'. That test encoded a real constraint at the time — authMiddleware
    // set userId null when Supabase was unconfigured and the route passed it
    // through, so requiring ownership would have 404'd every local-dev call.
    //
    // Both halves of that premise are gone. D1.3 made catalog.routes.ts:188 pass
    // `requireOwner(c)`, which 401s rather than yielding undefined, so the route
    // can no longer produce this input; D2 (WIC-2068) made `userId` required
    // here, so absence is unrepresentable at the signature. An absent owner
    // reaching this function is now a defect, and the fixture below is what it
    // would cost if the probe still skipped: a foreign resume, auto-applied into
    // a catalog under a null owner.
    const stub = scopedReadStub({
      resumes: [{ id: RESUME, userId: OTHER_USER }],
      catalog_diffs: [{ ...diffRow(), triggerId: RESUME, userId: null, id: '01HZ_DIFF_SU' }],
    });
    vi.mocked(getDb).mockReturnValue(stub.db as unknown as ReturnType<typeof getDb>);

    await expect(generateDiff('resume', RESUME, ABSENT_OWNER)).rejects.toThrow(NotFoundError);

    // The probe ran — it is no longer conditional — and matched nothing, so the
    // extraction that auto-applies into the caller's catalog never started.
    // Asserting the write path and not just the error keeps this honest: a 404
    // thrown for any other reason would still leave `processCatalogChange` unrun,
    // so the `opsOn` count is what pins *which* guard produced it.
    expect(stub.opsOn('resumes')).toHaveLength(1);
    expect(processCatalogChange).not.toHaveBeenCalled();
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

// The *default* (no explicit status) filter is two-armed since WIC-1428: a diff
// is listed when it is still `pending` OR when it carries open review items,
// whatever its apply status. The tenancy term stays an outer conjunct, so it
// still binds the whole disjunction rather than just one arm of it — which is
// the property these tests exist to pin.
const SCOPED_DEFAULT_DIFF_CLAUSE =
  '("catalog_diffs"."user_id" = $1 and ("catalog_diffs"."status" = $2 or "catalog_diffs"."open_review_count" > $3))';

describe('listDiffs tenancy', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [
      'the default pending filter',
      {} as ListDiffsOptions,
      SCOPED_DEFAULT_DIFF_CLAUSE,
      ['pending', 0],
    ],
    [
      'an explicit status filter',
      { status: 'approved' } as ListDiffsOptions,
      SCOPED_DIFF_CLAUSE,
      ['approved'],
    ],
  ] as const)('scopes the page to the caller alongside %s', async (_name, opts, clause, rest) => {
    const { selectWhere } = stubPagedListDb([]);

    await listDiffs(opts, CALLER);

    // Every conjunct, table-qualified, with each value pinned to the column
    // that binds it: $1 is always the tenancy term. A mutation that drops any
    // half — or swaps which column a value lands on — changes one of these two
    // lines. An explicit status collapses the disjunction to a single arm,
    // which is why the two cases pin different clauses.
    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(clause);
    expect(params).toEqual([CALLER, ...rest]);
  });

  it('binds the caller it was handed, not a fixed owner', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await listDiffs({}, OTHER_USER);

    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(SCOPED_DEFAULT_DIFF_CLAUSE);
    expect(params).toEqual([OTHER_USER, 'pending', 0]);
  });

  // ADR-010 D2 / AC-3 — see the note on the shared `PAGED_TENANCY_CASES` block.
  // `userId` is required now, so this call only compiles because `test/` is
  // outside `packages/api/tsconfig.json`; that is deliberate, and it is what lets
  // the assertion measure the predicate rather than the signature.
  it('keeps the tenancy term when an absent owner reaches it, and pages nothing', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await listDiffs({}, undefined as unknown as string);

    // The tenancy term survives and binds NULL, and both arms of the default
    // filter are still there behind it — a bare `toContain('user_id')` would
    // have missed the second half.
    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(SCOPED_DEFAULT_DIFF_CLAUSE);
    expect(params).toEqual([undefined, 'pending', 0]);
  });

  it('reads zero diffs when an absent owner reaches it', async () => {
    // The read itself, not its shape: stubPagedOwnedRow honours the clause, so a
    // predicate that dropped the tenancy term would surface this row.
    stubPagedOwnedRow(diffRow({ userId: CALLER, status: 'pending' }));

    const { diffs } = await listDiffs({}, undefined as unknown as string);

    expect(diffs).toEqual([]);
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
// Every case shares one option set across all its directions, so the tenancy term
// is the only thing that varies between them.
//
// ADR-010 D2 (WIC-2068) removed the unscoped direction these cases used to carry.
// `userId` is now required, so there is no longer a "single-user mode" clause to
// pin: an absent owner binds NULL into the *same* `scopedSql`, and the page comes
// back empty rather than carrying every tenant's rows. `unscopedSql` /
// `unscopedParams` are gone with it — do not reintroduce them, a case that renders
// a clause without the tenancy term is the defect, not a mode.

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
  /** A row owned by `userId`, shaped for this function's DTO mapper. */
  ownedRow: (userId: string) => { userId: string; id: string };
}

const PAGED_TENANCY_CASES: Record<string, PagedTenancyCase> = {
  listCompanies: {
    run: (userId) => listCompanies({}, userId),
    itemsKey: 'companies',
    scopedSql: '("company_catalog"."user_id" = $1 and "company_catalog"."is_deleted" = $2)',
    scopedTail: [false],
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
    ownedRow: (userId) => tagRow({ userId }) as { userId: string; id: string },
  },
  listTechStackTags: {
    run: (userId) => listTechStackTags({ category: 'language', needsReview: true }, userId),
    itemsKey: 'tags',
    scopedSql:
      '("tech_stack_tags"."user_id" = $1 and "tech_stack_tags"."category" = $2 and ' +
      '"tech_stack_tags"."needs_review" = $3)',
    scopedTail: ['language', true],
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
    ownedRow: (userId) => bulletRow({ userId }) as { userId: string; id: string },
  },
  listThemes: {
    run: (userId) => listThemes({ coreOnly: true }, userId),
    itemsKey: 'themes',
    scopedSql:
      '("recurring_themes"."user_id" = $1 and "recurring_themes"."is_core_strength" = $2 and ' +
      '"recurring_themes"."is_historical" = $3)',
    scopedTail: [true, false],
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

  // ADR-010 D2 / AC-3. `userId` is required, so neither of the next two calls
  // typechecks — but `packages/api/tsconfig.json` excludes `test/`, which is
  // precisely what lets them reach past the signature and measure what the
  // *predicate* does with an owner the type says cannot arrive. That is the
  // property worth pinning: the signature is the first line of defence, not the
  // only one, and a JS caller or an `as any` at some future call site does not
  // get an unscoped read.
  it('keeps the tenancy term when an absent owner reaches it, binding NULL', async () => {
    const { selectWhere } = stubPagedListDb([]);

    await tc.run(undefined as unknown as string);

    // Same clause as the scoped direction, not a narrowed one. Before D2 the
    // conjunct disappeared here and the remaining filters rendered a valid query
    // over every tenant's rows; now it survives and binds undefined, which
    // Postgres compares as NULL and no row satisfies.
    const { sql, params } = queryFor(selectWhere.mock.calls[0][0]);
    expect(sql).toBe(tc.scopedSql);
    expect(params).toEqual([undefined, ...tc.scopedTail]);
  });

  it('reads zero rows when an absent owner reaches it', async () => {
    // AC-3 wants the read asserted, not a response code. stubPagedOwnedRow
    // honours the clause it is handed, so this fails the moment the tenancy term
    // stops being emitted — a shape-only assertion would not have.
    stubPagedOwnedRow(tc.ownedRow(CALLER));

    const page = await tc.run(undefined as unknown as string);

    expect(page[tc.itemsKey]).toEqual([]);
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

  it('refuses an absent owner rather than passing no predicate at all', async () => {
    const { selectWhere } = stubStarEntriesDb([]);

    // INVERTED by WIC-2071 (ADR-010 D2). This previously asserted the opposite —
    // `.where(undefined)`, literally no predicate — and described it as
    // "single-user mode". Because tenancy was this query's *only* filter, that
    // fallback did not narrow the read, it removed the read's only bound and
    // returned every tenant's `quantified_bullets`. The signature is now
    // `userId: string` and the branch is deleted.
    await expect(listStarEntries(undefined as unknown as string)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
    });

    // Stronger than "the clause was scoped": no query was built at all, so there
    // is no predicate to get wrong. See `owner-required.fail-open.test.ts`.
    expect(selectWhere).not.toHaveBeenCalled();
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
