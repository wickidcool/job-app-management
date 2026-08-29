// UC-6 tenancy — `suggestBullets` read the STAR catalog across every user.
//
// The route already threads identity: `routes/resume-variants.ts:129` calls
// `suggestBullets(parsed.data, c.get('userId') ?? undefined)`. The service
// signature was `suggestBullets(input, _userId?)` — the underscore was the
// defect. Both catalog reads ran unqualified over `quantified_bullets`, and
// `rawText` — the user-authored accomplishment sentence — was copied verbatim
// into every `BulletSuggestionDTO` in the 200 response.
//
// Nothing downstream mitigates this. `supabase/migrations/0002_rls_current_schema.sql`
// grants its policies `TO authenticated USING (auth.uid() = user_id)`, but the API
// connects over a raw `postgres://` DATABASE_URL / Hyperdrive string and never calls
// `set_config('request.jwt.claims', ...)` — so it is not the `authenticated` role and
// the policies do not apply to it. The predicate has to be in the query.
//
// Fixed in WIC-1449. The two cases that shipped as `it.fails` trip-wires are plain
// `it` from here on, and the characterisation case is inverted to `not.toContain`
// (AC-5). The generating paths — D2 and D3, which also *persist* the leak — are in
// `star-catalog.tenancy.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { suggestBullets } from '../src/services/resume-variant.service.js';
import {
  stubDb,
  expectScopedTo,
  render,
  ORPHAN_OWNER,
  type CatalogRow,
} from './helpers/star-catalog-stub.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';

function bulletRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: '01HZ_BUL_001',
    rawText: 'Cut checkout latency 38% by batching inventory reads at Acme Corp.',
    impactCategory: 'performance',
    sourceId: '01HZ_RES_001',
    userId: CALLER,
    ...overrides,
  };
}

function stubCatalog(catalog: CatalogRow[]) {
  const stub = stubDb({ catalog });
  vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);
  return stub;
}

describe('suggestBullets tenancy (UC-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the caller id the route already passes', async () => {
    stubCatalog([bulletRow()]);

    // Guards the plumbing half only: the route hands identity to the service.
    // It says nothing about whether the service uses it — that is the rest.
    await expect(
      suggestBullets({ jobDescriptionText: 'Senior backend engineer' } as never, CALLER)
    ).resolves.toBeDefined();
  });

  it('scopes the catalog row read to the caller', async () => {
    const stub = stubCatalog([bulletRow(), bulletRow({ id: '01HZ_BUL_002', userId: OTHER })]);

    await suggestBullets({ jobDescriptionText: 'Senior backend engineer' } as never, CALLER);

    // Shipped as `.where(input.excludeBulletIds?.length ? notInArray(...) : undefined)`
    // — a filter over the whole table, with no owner term in either branch.
    expectScopedTo(stub.catalogClauses()[1], CALLER);
  });

  it('scopes the totalCatalogBullets count to the caller', async () => {
    const stub = stubCatalog([bulletRow(), bulletRow({ id: '01HZ_BUL_002', userId: OTHER })]);

    const result = await suggestBullets(
      { jobDescriptionText: 'Senior backend engineer' } as never,
      CALLER
    );

    // The count read had no `.where()` at all, so the number reported back to the
    // caller was the size of every user's catalog combined.
    expect(stub.reads[0]?.isCount, 'the count read is the first read issued').toBe(true);
    expectScopedTo(stub.catalogClauses()[0], CALLER);
    expect(result.totalCatalogBullets, 'counts only the caller-owned rows').toBe(1);
  });

  it('keeps the owner term when excludeBulletIds narrows the read further', async () => {
    const stub = stubCatalog([bulletRow(), bulletRow({ id: '01HZ_BUL_002', userId: OTHER })]);

    await suggestBullets(
      {
        jobDescriptionText: 'Senior backend engineer',
        excludeBulletIds: ['01HZ_BUL_009'],
      } as never,
      CALLER
    );

    // The exclusion branch is the one that already built a clause, so it is the
    // one most likely to lose the owner term when the two are combined.
    expectScopedTo(stub.catalogClauses()[1], CALLER);
    expect(
      render(stub.catalogClauses()[1]).sql,
      'the exclusion survives alongside the owner term'
    ).toContain('not in');
  });

  it("does not return another user's STAR rawText", async () => {
    const victimText = 'Recovered $2.1M in churned ARR by rebuilding onboarding at Initech.';
    stubCatalog([
      bulletRow({ id: '01HZ_BUL_MINE', rawText: 'Shipped the billing rewrite at Acme Corp.' }),
      bulletRow({ id: '01HZ_BUL_THEIRS', rawText: victimText, userId: OTHER }),
    ]);

    const result = await suggestBullets(
      { jobDescriptionText: 'Senior backend engineer, onboarding' } as never,
      CALLER
    );

    // This shipped as `toContain` — it characterised the open leak. Inverted here
    // in the same change that closes it, per AC-5.
    expect(result.suggestions.map((s) => s.rawText)).not.toContain(victimText);
    expect(result.suggestions.map((s) => s.bulletId)).toEqual(['01HZ_BUL_MINE']);
  });

  it('fails an owner-less caller closed — the scope term survives, so nothing is suggested', async () => {
    // Absent identity must never mean "all rows". The history of this one test
    // is the history of the fix:
    //
    //  - it first seeded `userId: null` and required that row back. That row
    //    cannot exist — `quantifiedBullets.userId` is `.notNull()` since
    //    `0017_enforce_userid_not_null.sql` (WIC-1465 review, REQUIRED 2).
    //  - it then asserted `IS NULL`, which matched nothing post-0017 and so was
    //    fail-closed, but kept an owner-absent branch inside `bulletOwnerScope`
    //    — a helper whose entire purpose is to centralise scoping. Every new
    //    call site inherited the fallback, which is what WIC-1638 measured.
    //
    // `bulletOwnerScope` now takes `userId: string` and emits an unconditional
    // equality; absence is rejected once at the route edge by `requireOwner`.
    // This asserts the predicate itself still fails closed on the path that
    // should be unreachable, rather than trusting the compiler to prove it is.
    const stub = stubCatalog([
      bulletRow({ id: '01HZ_BUL_ORPHAN', userId: ORPHAN_OWNER }),
      bulletRow({ id: '01HZ_BUL_THEIRS', userId: OTHER }),
    ]);

    const result = await suggestBullets(
      { jobDescriptionText: 'Senior backend engineer' } as never,
      undefined as unknown as string
    );

    // Fails closed by predicate, not by an empty fixture: the read carried an
    // owner equality against a table holding two owned rows, bound to the absent
    // owner rather than degraded to a bare match. Dropping the term — the mutant
    // this test exists to kill — would return both rows.
    const { sql, params } = render(stub.catalogClauses()[1]);
    expect(sql).toContain('"quantified_bullets"."user_id" = $');
    expect(params).toContain(undefined);
    expect(params).not.toContain(ORPHAN_OWNER);
    expect(params).not.toContain(OTHER);
    expect(result.suggestions).toEqual([]);
    expect(result.totalCatalogBullets).toBe(0);
  });
});
