// UC-6 tenancy — `suggestBullets` reads the STAR catalog across every user.
//
// The route already threads identity: `routes/resume-variants.ts:129` calls
// `suggestBullets(parsed.data, c.get('userId') ?? undefined)`. The service
// signature is `suggestBullets(input, _userId?)` — the underscore is the defect.
// Both catalog reads (`resume-variant.service.ts:829` count, `:833` rows) run
// unqualified over `quantified_bullets`, and `rawText` — the user-authored
// accomplishment sentence — is copied verbatim into every `BulletSuggestionDTO`
// in the 200 response.
//
// Nothing downstream mitigates this. `supabase/migrations/0002_rls_current_schema.sql`
// grants its policies `TO authenticated USING (auth.uid() = user_id)`, but the API
// connects over a raw `postgres://` DATABASE_URL / Hyperdrive string and never calls
// `set_config('request.jwt.claims', ...)` — so it is not the `authenticated` role and
// the policies do not apply to it. The predicate has to be in the query.
//
// The two `it.fails` cases below are the trip-wire: they pass today *because the
// assertion fails*, and vitest turns them red the moment the fix lands, which is
// when they must be converted to plain `it`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client.js';
import { suggestBullets } from '../src/services/resume-variant.service.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';

function bulletRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01HZ_BUL_001',
    rawText: 'Cut checkout latency 38% by batching inventory reads at Acme Corp.',
    impactCategory: 'performance',
    sourceId: '01HZ_RES_001',
    ...overrides,
  };
}

/**
 * `suggestBullets` issues two reads against `quantified_bullets`:
 *
 *   db.select({ count }).from(quantifiedBullets)                    // awaited off .from()
 *   db.select({ ... }).from(quantifiedBullets).where(c).limit(500)  // awaited off .limit()
 *
 * so `from()` has to be both thenable and chainable. Every `where` argument is
 * recorded in call order — asserting on the *rendered* predicate is what makes
 * this mutation-proof: `toHaveBeenCalled()` would still pass against
 * `.where(undefined)`, which is exactly what ships today.
 */
function stubDb(countRows: unknown[], bulletRows: unknown[]) {
  const whereArgs: unknown[] = [];
  const fromCalls: unknown[] = [];

  const makeFrom = (rows: unknown[]) => {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn((clause: unknown) => {
      whereArgs.push(clause);
      return { limit, then: (res: (v: unknown) => void) => res(rows) };
    });
    return { where, limit, then: (res: (v: unknown) => void) => res(rows) };
  };

  const from = vi
    .fn()
    .mockImplementationOnce((t: unknown) => {
      fromCalls.push(t);
      return makeFrom(countRows);
    })
    .mockImplementationOnce((t: unknown) => {
      fromCalls.push(t);
      return makeFrom(bulletRows);
    });

  const db = { select: vi.fn().mockReturnValue({ from }) };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);

  return { whereArgs, fromCalls, select: db.select, from };
}

const dialect = new PgDialect();

/** The clause filters `quantified_bullets` by owner, bound to this exact caller. */
function expectScopedTo(clause: unknown, userId: string) {
  expect(clause, 'no WHERE clause was built at all').toBeDefined();
  const { sql, params } = dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
  expect(sql).toContain('"quantified_bullets"."user_id" = $');
  expect(params).toContain(userId);
}

describe('suggestBullets tenancy (UC-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the caller id the route already passes', async () => {
    stubDb([{ count: 1 }], [bulletRow()]);

    // Guards the plumbing half only: the route hands identity to the service.
    // It says nothing about whether the service uses it — that is the next two.
    await expect(
      suggestBullets({ jobDescriptionText: 'Senior backend engineer' } as never, CALLER)
    ).resolves.toBeDefined();
  });

  it.fails('scopes the catalog row read to the caller', async () => {
    const { whereArgs } = stubDb([{ count: 2 }], [bulletRow()]);

    await suggestBullets({ jobDescriptionText: 'Senior backend engineer' } as never, CALLER);

    // Ships as `.where(input.excludeBulletIds?.length ? notInArray(...) : undefined)`
    // — a filter over the whole table, with no owner term in either branch.
    expectScopedTo(whereArgs[0], CALLER);
  });

  it.fails('scopes the totalCatalogBullets count to the caller', async () => {
    const { whereArgs } = stubDb([{ count: 2 }], [bulletRow()]);

    await suggestBullets({ jobDescriptionText: 'Senior backend engineer' } as never, CALLER);

    // `:827-829` has no `.where()` at all, so the count reported back to the
    // caller is the size of every user's catalog combined.
    expect(whereArgs.length, 'the count read issued no WHERE clause').toBeGreaterThan(1);
    expectScopedTo(whereArgs[1], CALLER);
  });

  it("returns another user's STAR rawText verbatim — characterises the open leak", async () => {
    const victimText = 'Recovered $2.1M in churned ARR by rebuilding onboarding at Initech.';
    stubDb(
      [{ count: 2 }],
      [
        bulletRow({ id: '01HZ_BUL_MINE', rawText: 'Shipped the billing rewrite at Acme Corp.' }),
        bulletRow({ id: '01HZ_BUL_THEIRS', rawText: victimText, userId: OTHER }),
      ]
    );

    const result = await suggestBullets(
      { jobDescriptionText: 'Senior backend engineer, onboarding' } as never,
      CALLER
    );

    // Documents today's behaviour, not the target: the fix makes the foreign row
    // unreachable, so this expectation flips with the two trip-wires above and
    // must be rewritten to `not.toContain` in the same change.
    expect(result.suggestions.map((s) => s.rawText)).toContain(victimText);
  });
});
