/**
 * Standing mutation check for the shared tenancy harness (WIC-1491, ask 3).
 *
 * The defect this repo keeps shipping is not in any one service — it is in the
 * *assertions*. Three separate tenancy suites (WIC-1378, WIC-1449, WIC-1437)
 * each wrote a check that could not tell `and(idTerm, ownerTerm)` from
 * `or(idTerm, ownerTerm)`, and each stayed green through the leak it existed to
 * catch. Fixing those three files individually guarantees a fourth.
 *
 * So the mutation is applied *here*, in CI, on every run. `SHAPES` below holds
 * the predicate shapes the services really build. Each one is asserted twice:
 *
 *   - built with `and` → `expectScopedTo` must pass
 *   - built with `or`  → `expectScopedTo` must **fail**
 *
 * The second direction is the one that matters, and it is the one a presence
 * check cannot satisfy. `rejects the weak assertion this harness replaces`
 * proves that claim rather than asserting it: it runs the old two-line form
 * against the `or` mutant and shows it passing.
 *
 * If someone ever weakens `expectScopedTo` back toward substring matching, this
 * file goes red. That is the whole point — recurrence four gets caught by CI
 * instead of by a sweep.
 */
import { describe, it, expect } from 'vitest';
import { eq, and, or, inArray, isNull, isNotNull, gte, ilike, ne } from 'drizzle-orm';
import { quantifiedBullets, coverLetters, catalogDiffs } from '../../src/db/schema.js';
import {
  expectScopedTo,
  expectEveryReadScopedTo,
  applyTenancyPredicate,
  predicateFor,
  renderClause,
  columnRefsOf,
} from './tenancy.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const OTHER = 'c2a91e77-5f30-4d18-8a41-6b0e9d3c8f12';
const ID_A = '01HZBUL0000000000000000001';
const ID_B = '01HZBUL0000000000000000002';

/** `expect(...).toBe(...)` throws; this reports whether an assertion held. */
function fails(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ── The and→or mutation, applied to every shape the services build ───────────

interface Shape {
  name: string;
  table: string;
  ids?: string[];
  extra?: Record<string, unknown>;
  /** `join` is `and` on the baseline run and `or` on the mutant run. */
  build: (join: typeof and) => unknown;
}

const SHAPES: Shape[] = [
  {
    // `getCoverLetter` / `updateBullet` — single caller-supplied id.
    name: 'eq(id) + eq(userId)',
    table: 'quantified_bullets',
    ids: [ID_A],
    build: (join) => join(eq(quantifiedBullets.id, ID_A), eq(quantifiedBullets.userId, CALLER)),
  },
  {
    // `fetchStarEntries` — a batch of caller-supplied ids. WIC-1437's IDOR.
    name: 'inArray(id) + eq(userId)',
    table: 'quantified_bullets',
    ids: [ID_A, ID_B],
    build: (join) =>
      join(inArray(quantifiedBullets.id, [ID_A, ID_B]), eq(quantifiedBullets.userId, CALLER)),
  },
  {
    // `suggestBullets` / the `list*` reads — owner term plus a non-tenancy filter.
    name: 'eq(userId) + non-tenancy filter',
    table: 'quantified_bullets',
    extra: { impactCategory: 'performance' },
    build: (join) =>
      join(
        eq(quantifiedBullets.userId, CALLER),
        eq(quantifiedBullets.impactCategory, 'performance')
      ),
  },
  {
    // A filter this parser deliberately does not model, to prove an unmodelled
    // operator cannot rescue a broken predicate: `opaque` is permissive, so the
    // `or` mutant still leaks and still goes red.
    name: 'eq(userId) + unmodelled operators (ilike, gte)',
    table: 'quantified_bullets',
    extra: { rawText: 'anything', extractedAt: '2026-01-01' },
    build: (join) =>
      join(
        eq(quantifiedBullets.userId, CALLER),
        ilike(quantifiedBullets.rawText, '%latency%'),
        gte(quantifiedBullets.extractedAt, new Date('2026-01-01T00:00:00.000Z'))
      ),
  },
  {
    name: 'cover_letters: eq(id) + eq(userId)',
    table: 'cover_letters',
    ids: [ID_A],
    build: (join) => join(eq(coverLetters.id, ID_A), eq(coverLetters.userId, CALLER)),
  },
  {
    name: 'catalog_diffs: eq(id) + eq(userId)',
    table: 'catalog_diffs',
    ids: [ID_A],
    build: (join) => join(eq(catalogDiffs.id, ID_A), eq(catalogDiffs.userId, CALLER)),
  },
];

describe('tenancy harness — the and→or mutation is a standing check', () => {
  for (const shape of SHAPES) {
    it(`accepts the scoped form: ${shape.name}`, () => {
      expectScopedTo(shape.build(and), {
        table: shape.table,
        userId: CALLER,
        ids: shape.ids,
        extra: shape.extra,
      });
    });

    it(`REJECTS the or-mutant: ${shape.name}`, () => {
      const mutant = shape.build(or as unknown as typeof and);
      expect(
        fails(() =>
          expectScopedTo(mutant, {
            table: shape.table,
            userId: CALLER,
            ids: shape.ids,
            extra: shape.extra,
          })
        ),
        `and→or on "${shape.name}" was NOT detected. Postgres returns the union for this ` +
          `predicate, so every row in "${shape.table}" reaches the caller:\n  ` +
          renderClause(mutant).sql
      ).toBe(true);
    });
  }
});

describe('tenancy harness — the weak assertion it replaces', () => {
  it('rejects the weak assertion this harness replaces', () => {
    // Verbatim the form that shipped in WIC-1378, WIC-1449 and WIC-1437.
    const weak = (clause: unknown, userId: string) => {
      const { sql, params } = renderClause(clause);
      expect(sql).toContain('"quantified_bullets"."user_id" = $');
      expect(params).toContain(userId);
    };

    const leaky = or(eq(quantifiedBullets.id, ID_A), eq(quantifiedBullets.userId, CALLER));

    // The weak form passes against the leak. This is not hypothetical — it is
    // why the same defect was filed three times in nine hours.
    expect(fails(() => weak(leaky, CALLER))).toBe(false);

    // The shared harness does not.
    expect(
      fails(() =>
        expectScopedTo(leaky, { table: 'quantified_bullets', userId: CALLER, ids: [ID_A] })
      )
    ).toBe(true);
  });

  it('rejects the independent-regex row filter it replaces', () => {
    // The WIC-1437 variant: decide each constraint with its own regex, then
    // apply both conjunctively. The conjunction is the test's assumption, so the
    // `or` mutant filters identically to the `and` original and reads green.
    const structureBlind = <T extends { id: string; userId: string }>(
      rows: T[],
      clause: unknown,
      table: string
    ): T[] => {
      const { sql: text, params } = renderClause(clause);
      const constrainsId = new RegExp(`"${table}"\\."id"\\s*(=|in\\s*\\()`).test(text);
      const scopesOwner = new RegExp(`"${table}"\\."user_id"\\s*=`).test(text);
      return rows.filter((r) => {
        if (constrainsId && !params.includes(r.id)) return false;
        if (scopesOwner && !params.includes(r.userId)) return false;
        return true;
      });
    };

    const rows = [
      { id: ID_A, userId: CALLER, rawText: 'mine' },
      { id: ID_B, userId: OTHER, rawText: 'VICTIM_SECRET' },
    ];
    const scoped = and(
      inArray(quantifiedBullets.id, [ID_A, ID_B]),
      eq(quantifiedBullets.userId, CALLER)
    );
    const leaky = or(
      inArray(quantifiedBullets.id, [ID_A, ID_B]),
      eq(quantifiedBullets.userId, CALLER)
    );

    // Blind: identical output for both, so the mutation is invisible.
    expect(structureBlind(rows, scoped, 'quantified_bullets')).toEqual(
      structureBlind(rows, leaky, 'quantified_bullets')
    );

    // Honest: the union leaks the victim row, which is what Postgres would do.
    expect(applyTenancyPredicate(rows, scoped, 'quantified_bullets')).toEqual([rows[0]]);
    expect(applyTenancyPredicate(rows, leaky, 'quantified_bullets')).toEqual(rows);
  });
});

// ── The rest of the WIC-1378 mutation matrix ─────────────────────────────────

describe('tenancy harness — the remaining mutations', () => {
  const scope = { table: 'quantified_bullets', userId: CALLER, ids: [ID_A] } as const;

  it('M1 rejects a removed WHERE clause', () => {
    expect(fails(() => expectScopedTo(undefined, scope))).toBe(true);
    expect(fails(() => expectScopedTo(and(undefined, undefined), scope))).toBe(true);
  });

  it('M2 rejects a dropped owner term (id half only)', () => {
    expect(fails(() => expectScopedTo(eq(quantifiedBullets.id, ID_A), scope))).toBe(true);
  });

  it('M3 rejects a dropped id term when ids are expected', () => {
    const ownerOnly = eq(quantifiedBullets.userId, CALLER);
    expect(fails(() => expectScopedTo(ownerOnly, scope))).toBe(true);
    // …and is fine when the read genuinely has no id half.
    expect(
      fails(() => expectScopedTo(ownerOnly, { table: 'quantified_bullets', userId: CALLER }))
    ).toBe(false);
  });

  it('M4 rejects an owner term bound to the wrong user', () => {
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.id, ID_A), eq(quantifiedBullets.userId, OTHER)),
          scope
        )
      )
    ).toBe(true);
  });

  it('M5 rejects an owner term on the wrong column', () => {
    // `source_id = $caller` binds the caller id — `params.toContain(userId)`
    // passes — but filters on a column that has nothing to do with ownership.
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.id, ID_A), eq(quantifiedBullets.sourceId, CALLER)),
          scope
        )
      )
    ).toBe(true);
  });

  it('M6 rejects an owner term on the wrong table', () => {
    // Table-qualified substring matching catches this only if the test knows to
    // look for the right table name; the evaluator catches it structurally,
    // because a term on another table constrains nothing about this row.
    expect(
      fails(() =>
        expectScopedTo(and(eq(quantifiedBullets.id, ID_A), eq(coverLetters.userId, CALLER)), scope)
      )
    ).toBe(true);
  });

  it('M7 rejects an id term bound to the wrong column', () => {
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.sourceId, ID_A), eq(quantifiedBullets.userId, CALLER)),
          scope
        )
      )
    ).toBe(true);
  });

  it('M8 rejects a negated owner term', () => {
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.id, ID_A), ne(quantifiedBullets.userId, OTHER)),
          scope
        )
      )
    ).toBe(true);
  });

  it('M9 rejects an owner term widened to include orphan rows', () => {
    // `user_id = $caller OR user_id IS NULL` looks defensive and is not: rows
    // with a null owner belong to nobody and must not be readable.
    expect(
      fails(() =>
        expectScopedTo(
          and(
            eq(quantifiedBullets.id, ID_A),
            or(eq(quantifiedBullets.userId, CALLER), isNull(quantifiedBullets.userId))
          ),
          scope
        )
      )
    ).toBe(true);
  });

  it('regression control: the correct predicate still passes', () => {
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.id, ID_A), eq(quantifiedBullets.userId, CALLER)),
          scope
        )
      )
    ).toBe(false);
  });

  it('rejects a predicate that matches nothing at all', () => {
    // Guards the guard: without the "caller's own row is admitted" probe, a
    // predicate that returns zero rows would read as flawlessly scoped.
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.userId, CALLER), eq(quantifiedBullets.userId, OTHER)),
          {
            table: 'quantified_bullets',
            userId: CALLER,
          }
        )
      )
    ).toBe(true);
  });
});

/**
 * `expectScopedTo` fires four probes. The tests above kill the `or` mutants many
 * times over, which is good for coverage and bad for pinning: deleting a probe
 * left the suite green, because another probe happened to reject the same
 * clauses. A probe nothing pins is a probe that can be quietly deleted.
 *
 * Each case below is chosen so that **exactly one** probe rejects it. Delete
 * that probe from `expectScopedTo` and precisely one of these goes red.
 */
describe('tenancy harness — each probe is load-bearing', () => {
  const scope = { table: 'quantified_bullets', userId: CALLER, ids: [ID_A] } as const;

  it('probe 1 (caller’s own row is admitted) — pinned by a self-contradictory predicate', () => {
    // Own row rejected; foreign, orphan and other-id rows all rejected too.
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.userId, CALLER), eq(quantifiedBullets.userId, OTHER)),
          {
            table: 'quantified_bullets',
            userId: CALLER,
          }
        )
      )
    ).toBe(true);
  });

  it('probe 2 (foreign owner is rejected) — pinned by an owner-agnostic NOT NULL term', () => {
    // `id = $A AND user_id IS NOT NULL` looks like it scopes and does not. It
    // admits the *foreign* row while still rejecting the orphan row and every
    // other id — so probe 2 is the only thing standing between this and green.
    expect(
      fails(() =>
        expectScopedTo(
          and(eq(quantifiedBullets.id, ID_A), isNotNull(quantifiedBullets.userId)),
          scope
        )
      )
    ).toBe(true);
  });

  it('probe 3 (orphan row is rejected) — pinned by the owner term widened with IS NULL', () => {
    // Rejects the foreign row, so probe 2 passes; admits the unowned row.
    expect(
      fails(() =>
        expectScopedTo(
          and(
            eq(quantifiedBullets.id, ID_A),
            or(eq(quantifiedBullets.userId, CALLER), isNull(quantifiedBullets.userId))
          ),
          scope
        )
      )
    ).toBe(true);
  });

  it('probe 4 (unrequested id is rejected) — pinned by a correctly scoped read with no id half', () => {
    // Perfectly tenanted, so probes 1–3 all pass; it just does not restrict to
    // the ids the caller asked for.
    expect(fails(() => expectScopedTo(eq(quantifiedBullets.userId, CALLER), scope))).toBe(true);
  });
});

// ── Supporting API ───────────────────────────────────────────────────────────

describe('tenancy harness — supporting API', () => {
  it('expectEveryReadScopedTo fails loudly when no read was recorded', () => {
    // A vacuous pass is the failure mode of every "assert on the reads we saw"
    // loop: zero matching reads, zero assertions, green.
    expect(
      fails(() =>
        expectEveryReadScopedTo([{ table: 'cover_letters', clause: undefined }], {
          table: 'quantified_bullets',
          userId: CALLER,
        })
      )
    ).toBe(true);
  });

  it('expectEveryReadScopedTo checks every matching read, not just the first', () => {
    const good = and(eq(quantifiedBullets.id, ID_A), eq(quantifiedBullets.userId, CALLER));
    const bad = eq(quantifiedBullets.id, ID_B);
    expect(
      fails(() =>
        expectEveryReadScopedTo(
          [
            { table: 'quantified_bullets', clause: good },
            { table: 'quantified_bullets', clause: bad },
          ],
          { table: 'quantified_bullets', userId: CALLER }
        )
      )
    ).toBe(true);
  });

  it('predicateFor treats a missing clause as matching everything', () => {
    const admits = predicateFor(undefined, 'quantified_bullets');
    expect(admits({ id: ID_A, userId: OTHER })).toBe(true);
  });

  it('columnRefsOf reports every table.column the clause touches', () => {
    expect(
      columnRefsOf(and(eq(quantifiedBullets.id, ID_A), eq(coverLetters.userId, CALLER)))
    ).toEqual([
      { table: 'quantified_bullets', column: 'id' },
      { table: 'cover_letters', column: 'user_id' },
    ]);
  });

  it('parses nested groups without losing structure', () => {
    // `and(a, or(b, c))` must stay an `and` of an `or`, not flatten into either.
    const clause = and(
      eq(quantifiedBullets.userId, CALLER),
      or(
        eq(quantifiedBullets.impactCategory, 'performance'),
        eq(quantifiedBullets.impactCategory, 'cost')
      )
    );
    const admits = predicateFor(clause, 'quantified_bullets');
    expect(admits({ id: ID_A, userId: CALLER, impactCategory: 'performance' })).toBe(true);
    expect(admits({ id: ID_A, userId: CALLER, impactCategory: 'other' })).toBe(false);
    expect(admits({ id: ID_A, userId: OTHER, impactCategory: 'performance' })).toBe(false);
  });
});
