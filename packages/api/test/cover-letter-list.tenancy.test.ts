/**
 * WIC-1614 — `listCoverLetters` owner conjunction, measured.
 *
 * The predicate is **correct as shipped**. This file exists because nothing in
 * the repo could tell whether it was: flip
 *
 * ```ts
 * baseQuery.where(conditions.length === 1 ? conditions[0] : and(...conditions))
 * ```
 *
 * to `or(...conditions)` in `cover-letter.service.ts` and the whole API suite
 * stayed green. `listCoverLetters` was reachable only through a **mocked
 * service** in `cover-letter.routes.test.ts`, so no test in the repo ever
 * rendered its `where` clause. It was the ninth owner-bearing conjunction in
 * that file and the only one the `and`→`or` matrix did not kill.
 *
 * ## The mutation is conditional — which is what makes this test's shape load-bearing
 *
 * With an owner and **no other filter**, `conditions.length === 1` short-circuits
 * to `conditions[0]`; there is no `and()` to flip and the owner-only list stays
 * scoped under the mutant. It takes `userId` **plus** at least one of
 * `status` / `company` / `search` to build the `and(...)` that can widen.
 *
 * So a negative case that lists with no filters passes under the mutant and
 * proves nothing. Every guard here therefore pairs the owner with a second
 * filter. The owner-only case is kept at the bottom, explicitly labelled as a
 * non-guard, so the next reader does not mistake it for coverage.
 *
 * ## Two independent oracles
 *
 * 1. **Behavioural** — the fake `getDb()` filters fixtures by
 *    `applyTenancyPredicate`, i.e. by the predicate the service really built, so
 *    the returned DTO list is honest. A stub that resolves a canned row set
 *    whatever it is handed reports green against the leak and the fix alike.
 * 2. **Structural** — `expectScopedTo` re-evaluates the captured clause against
 *    probe rows, so `and`→`or`, a wrong-table term, and a missing `where` all
 *    fail it by construction (WIC-1491 / WIC-1502).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyTenancyPredicate, expectScopedTo } from './helpers/tenancy.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ATTACKER = '11111111-1111-4111-8111-111111111111';
const VICTIM = '22222222-2222-4222-8222-222222222222';

const CL_ATT = '01HXK5R3J7Q8N2M4P6W9Y1Z3A9';
const CL_ATT_FINAL = '01HXK5R3J7Q8N2M4P6W9Y1Z3A8';
const CL_VIC = '01HXK5R3J7Q8N2M4P6W9Y1Z3V9';

const VICTIM_CONTENT = 'VICTIM_LETTER_SECRET — my confidential salary ask is 250k.';

function row(
  id: string,
  userId: string,
  over: Partial<Record<string, unknown>> = {}
): Record<string, any> {
  return {
    id,
    userId,
    status: 'draft',
    title: 'Cover Letter',
    targetCompany: 'Acme',
    targetRole: 'Engineer',
    tone: 'professional',
    lengthVariant: 'standard',
    emphasis: 'balanced',
    content: 'ATTACKER_LETTER Dear Hiring Manager, I am writing to apply.',
    createdAt: new Date('2026-04-26T14:30:00.000Z'),
    updatedAt: new Date('2026-04-26T14:30:00.000Z'),
    version: 1,
    ...over,
  };
}

/**
 * The victim row is a `draft` at `Acme` exactly like the attacker's, so it is
 * separated from the attacker's rows by the **owner term alone**. If the second
 * filter did any of the excluding, the mutant would still be caught by the
 * status filter and this file would be measuring the wrong thing.
 */
const coverLetterRows = [
  row(CL_ATT, ATTACKER),
  row(CL_ATT_FINAL, ATTACKER, { status: 'finalized' }),
  row(CL_VIC, VICTIM, { content: VICTIM_CONTENT }),
];

// ── Predicate-honest fake db ──────────────────────────────────────────────────

/** Every `where` clause the service handed us this test, for the structural oracle. */
let readClauses: unknown[] = [];

function tableNameOf(table: any): string {
  return table?.[Symbol.for('drizzle:Name')] ?? table?.[Symbol.for('drizzle:BaseName')] ?? 'other';
}

/**
 * `listCoverLetters` chains `.orderBy().limit().offset()`, and takes the
 * `.orderBy()` hop **without** a `.where()` when no condition applies — so both
 * the pre- and post-`where` builders have to carry the full chain. A `limit()`
 * that resolved straight to a promise is what made this service function
 * unreachable from a fake db, and is a large part of why its owner term went
 * unpinned for so long.
 */
function chainable(rows: any[]): any {
  const self: any = {
    orderBy: () => self,
    limit: (n: number) => {
      const capped = rows.slice(0, n);
      const after: any = {
        offset: (o: number) => Promise.resolve(capped.slice(o)),
        then: (res: any, rej: any) => Promise.resolve(capped).then(res, rej),
      };
      return after;
    },
    offset: (o: number) => Promise.resolve(rows.slice(o)),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  };
  return self;
}

function makeFakeDb() {
  return {
    select: (_fields?: unknown) => ({
      from: (table: any) => {
        const name = tableNameOf(table);
        const source = name === 'cover_letters' ? coverLetterRows : [];
        const base = chainable(source as any[]);
        base.where = (clause: unknown) => {
          readClauses.push(clause);
          return chainable(applyTenancyPredicate(source as any[], clause, name));
        };
        return base;
      },
    }),
  };
}

vi.mock('../src/db/client.js', () => ({ getDb: () => makeFakeDb() }));

const { listCoverLetters } = await import('../src/services/cover-letter.service.js');

/** The single clause the list read built. Fails loudly rather than asserting vacuously. */
function soleClause(): unknown {
  expect(
    readClauses.length,
    'listCoverLetters issued no `where` at all — this read is unscoped'
  ).toBe(1);
  return readClauses[0];
}

beforeEach(() => {
  readClauses = [];
});

// ── Guards ────────────────────────────────────────────────────────────────────

describe('listCoverLetters tenancy (WIC-1614)', () => {
  it('owner + status: does not return another user’s draft', async () => {
    const { coverLetters: got } = await listCoverLetters({ status: 'draft' }, ATTACKER);

    // Behavioural oracle. Under `or(...)` this comes back as [CL_ATT, CL_VIC],
    // i.e. `GET /api/cover-letters?status=draft` serves another user's summaries.
    expect(got.map((c) => c.id)).toEqual([CL_ATT]);
    expect(JSON.stringify(got)).not.toContain('VICTIM_LETTER_SECRET');

    // Structural oracle over the same clause. `extra` supplies the column the
    // second filter constrains — a column the probe rows do not model evaluates
    // to UNKNOWN, which resolves permissively, so omitting it could only
    // under-report the leak.
    expectScopedTo(soleClause(), {
      table: 'cover_letters',
      userId: ATTACKER,
      extra: { status: 'draft' },
    });
  });

  it('owner + company: does not return another user’s letter at the same company', async () => {
    const { coverLetters: got } = await listCoverLetters({ company: 'Acme' }, ATTACKER);

    expect(got.map((c) => c.id)).toEqual([CL_ATT, CL_ATT_FINAL]);
    expect(JSON.stringify(got)).not.toContain('VICTIM_LETTER_SECRET');

    // `ilike` is deliberately unmodelled by the evaluator and reads as UNKNOWN.
    // That is still decisive here: under `and` the foreign row is excluded by the
    // owner term (false ∧ unknown = false), while under `or` it becomes
    // unknown and is admitted. The mutation is caught without the harness having
    // to pretend it understands pattern matching.
    expectScopedTo(soleClause(), {
      table: 'cover_letters',
      userId: ATTACKER,
      extra: { targetCompany: 'Acme' },
    });
  });

  it('owner + search: does not return another user’s letter matching the query', async () => {
    const { coverLetters: got } = await listCoverLetters({ search: 'Engineer' }, ATTACKER);

    expect(got.map((c) => c.id)).toEqual([CL_ATT, CL_ATT_FINAL]);
    expect(JSON.stringify(got)).not.toContain('VICTIM_LETTER_SECRET');

    expectScopedTo(soleClause(), {
      table: 'cover_letters',
      userId: ATTACKER,
      extra: { targetRole: 'Engineer' },
    });
  });

  /**
   * NOT a guard — kept deliberately, and deliberately labelled.
   *
   * With owner and no second filter, `conditions.length === 1` returns
   * `conditions[0]` and no `and()` is ever constructed, so this case is green
   * under the `and`→`or` mutant too. It is here to pin the short-circuit branch
   * itself (a regression that dropped the owner term entirely would still fail
   * it), not to measure the conjunction. Do not treat it as covering WIC-1614.
   */
  it('owner only: still scoped, but proves nothing about the conjunction', async () => {
    const { coverLetters: got } = await listCoverLetters({}, ATTACKER);

    expect(got.map((c) => c.id)).toEqual([CL_ATT, CL_ATT_FINAL]);
    expectScopedTo(soleClause(), { table: 'cover_letters', userId: ATTACKER });
  });
});
