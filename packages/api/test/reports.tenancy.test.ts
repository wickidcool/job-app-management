/**
 * WIC-2065 — the reports vertical is owner-scoped unconditionally (ADR-010 AC-T0).
 *
 * ## The defect
 *
 * All five report services took `userId?: string` and spelled the owner term as
 * something the absent owner could switch **off**:
 *
 * ```ts
 * const whereClause = userId ? and(statusTerm, eq(applications.userId, userId)) : statusTerm;
 * const conditions  = [statusTerm, ...(userId ? [eq(applications.userId, userId)] : [])];
 * if (userId) conditions.push(eq(applications.userId, userId));
 * ```
 *
 * Note what that is not. It is not an owner term *weakened* to `IS NULL` — the
 * shape eight other services in this package use deliberately, where an absent
 * owner scopes to the orphan rows and `audit-owner-predicates.mjs` baselines it
 * as fail-**closed**. Here the owner term was **absent from the query
 * altogether**, so the predicate reduced to the status filter and the read
 * returned every tenant's `applications` rows. `/api/reports/pipeline` served
 * the whole company's job search to a caller with no identity, and the four
 * Reports pages rendered it.
 *
 * The one reachable caller was `middleware/auth.ts`'s `?? null` pair: a token
 * that verifies but carries no `sub` (WIC-1554). The route then laundered that
 * null with `c.get('userId') ?? undefined` — the exact shape `require-owner.ts`
 * names in its own docstring — and the decision landed in the predicate.
 *
 * ## What this file grades, and what it deliberately does not
 *
 * Two oracles, per the WIC-1491 / WIC-1502 harness:
 *
 *   1. **Behavioural** — `scopedReadStub` filters fixtures by the predicate the
 *      service really built, so the returned DTO list is honest. A stub that
 *      resolves a canned row set whatever it is handed reads green against the
 *      leak and the fix alike, which is how twelve predicates were flipped
 *      `and`->`or` with the suite green (WIC-1537).
 *   2. **Structural** — `expectScopedTo` re-evaluates the captured clause against
 *      probe rows, so `and`->`or`, a wrong-table term, an owner bound to the
 *      wrong column, and a missing `where` all fail by construction.
 *
 * **The absent-owner block is the one that was red before the fix.** A test that
 * only supplies a concrete owner pins *preserved* behaviour: the predicate was
 * already correct for an identified caller, so such a test passes against the
 * pre-fix tree and is blind to the mutant that reverts this change (WIC-2062).
 * The hazard is the absent-owner arm, so that is what the first block mutates.
 *
 * Measured against `main` @ 2143bb60, pre-fix, this file alone:
 *
 *   | block                          | pre-fix | post-fix |
 *   |--------------------------------|---------|----------|
 *   | absent owner returns no rows   | **RED** (all 5 leak) | GREEN |
 *   | concrete owner stays scoped    | green   | green    |
 *
 * ## Why an absent owner can still be *called* after the fix
 *
 * It cannot be *reached*: the signature is `userId: string`, and
 * `requireOwner(c)` 401s at the route edge before the service runs
 * (`require-owner.routes.test.ts` pins that half, including the load-bearing
 * "the service was never called at all"). The cast below smuggles the absence
 * past the type system on purpose, to grade the predicate itself rather than
 * the guard in front of it — defence in depth, and the only way to keep an
 * AC-T0 assertion on this layer once absence is unrepresentable.
 *
 * It passes because `eq(applications.userId, undefined)` binds SQL `NULL`
 * (verified: drizzle renders `"user_id" = $2` with param `null`), and `= NULL`
 * is `NULL`, which Postgres does not treat as a match. So the fixed predicate
 * is fail-closed by SQL's own semantics, not by a branch — which is precisely
 * why deleting the branch was safe.
 *
 * One honesty note on that: the harness's evaluator resolves `col = null`
 * against a row whose owner *is* null as a match, where Postgres would match
 * nothing. The gap only ever makes the harness **more** permissive than
 * production, so it cannot manufacture a pass — but it is why no orphan
 * (`user_id IS NULL`) row appears in these fixtures. `expectScopedTo`'s probe 3
 * covers the orphan case for the concrete-owner block, where the term is a
 * plain `=` against a real uuid and the two agree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scopedReadStub, type ScopedReadStub } from './helpers/scoped-read-stub.js';
import { expectScopedTo, type ProbeRow } from './helpers/tenancy.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ATTACKER = '11111111-1111-4111-8111-111111111111';
const VICTIM = '22222222-2222-4222-8222-222222222222';

const APP_ATT = '01HXK5R3J7Q8N2M4P6W9Y1Z3A1';
const APP_VIC = '01HXK5R3J7Q8N2M4P6W9Y1Z3V1';

/** Renders into every report DTO that carries a company, so a leak is greppable. */
const VICTIM_COMPANY = 'VICTIM_CO — confidential, another tenant’s job search';

const OLD = new Date('2026-01-04T09:00:00.000Z');

/**
 * One `applications` row. Every field any of the five reports reads is present,
 * because `scopedReadStub` ignores the `.select()` projection and hands back the
 * whole row — a missing `updatedAt` surfaces as a `.toISOString()` TypeError
 * rather than as a scoping failure.
 */
function row(id: string, userId: string, over: ProbeRow = {}): ProbeRow {
  return {
    id,
    userId,
    status: 'applied',
    jobTitle: 'Staff Engineer',
    company: 'Acme',
    location: 'Remote',
    nextAction: 'Follow up with the recruiter',
    nextActionDue: '2026-01-09',
    contact: 'recruiter@example.com',
    url: 'https://example.com/jobs/1',
    salaryRange: '200k-240k',
    compTarget: '220k',
    createdAt: OLD,
    updatedAt: OLD,
    ...over,
  };
}

/**
 * The five entry points, each with a fixture pair that its **own** non-owner
 * filter admits.
 *
 * The victim row is identical to the attacker's but for the owner, so the two
 * are separated by the owner term **alone**. If the status filter did any of the
 * excluding, this file would be measuring the status filter (WIC-1614).
 */
interface Case {
  name: string;
  /** `status` the report's own filter requires, applied to both rows. */
  status: string;
  run: (stub: ScopedReadStub, owner: string) => Promise<unknown>;
  /** Application ids the response carries, in whatever shape that report uses. */
  ids: (response: any) => string[];
}

const CASES: Case[] = [
  {
    name: 'getPipelineReport',
    status: 'applied', // inArray(status, ACTIVE_STATUSES)
    run: async (_s, owner) =>
      (await import('../src/services/reports.service.js')).getPipelineReport({}, owner),
    ids: (r) => r.groups.flatMap((g: any) => g.applications.map((a: any) => a.id)),
  },
  {
    name: 'getNeedsActionReport',
    status: 'applied', // notInArray(status, TERMINAL_STATUSES) + nextAction/Due not null
    run: async (_s, owner) =>
      (await import('../src/services/reports.service.js')).getNeedsActionReport({}, owner),
    ids: (r) => r.applications.map((a: any) => a.id),
  },
  {
    name: 'getStaleReport',
    status: 'applied', // staleWhere: inArray(status, STALE_STATUSES) + updatedAt < cutoff
    run: async (_s, owner) =>
      (await import('../src/services/reports.service.js')).getStaleReport({}, owner),
    ids: (r) => r.applications.map((a: any) => a.id),
  },
  {
    name: 'getClosedLoopReport',
    status: 'rejected', // inArray(status, terminalStatuses)
    run: async (_s, owner) =>
      (await import('../src/services/reports.service.js')).getClosedLoopReport({}, owner),
    ids: (r) => r.applications.map((a: any) => a.id),
  },
  {
    name: 'getByFitTierReport',
    status: 'applied', // notInArray(status, TERMINAL_STATUSES) unless includeTerminal
    run: async (_s, owner) =>
      (await import('../src/services/reports.service.js')).getByFitTierReport({}, owner),
    ids: (r) => r.groups.flatMap((g: any) => g.applications.map((a: any) => a.id)),
  },
];

// ── Predicate-honest fake db ──────────────────────────────────────────────────

let stub: ScopedReadStub;

vi.mock('../src/db/client.js', () => ({ getDb: () => stub.db }));

function install(status: string): void {
  stub = scopedReadStub({
    applications: [
      row(APP_ATT, ATTACKER, { status }),
      row(APP_VIC, VICTIM, { status, company: VICTIM_COMPANY }),
    ],
    // `getStaleReport` and `getClosedLoopReport` follow up with a read of
    // `status_history` keyed by the ids the page already returned. Empty is
    // correct: it is downstream of the scoped read, so it can only narrow.
    status_history: [],
  });
}

/**
 * The single `applications` clause the report built. Fails loudly rather than
 * asserting vacuously — a report that issued no `where` at all is the worst
 * case, not an absence of evidence.
 */
function soleApplicationsClause(): unknown {
  const ops = stub.opsOn('applications');
  expect(ops.length, 'the report issued no read of `applications` at all').toBe(1);
  expect(
    ops[0].clause,
    'the report read `applications` with no `where` clause — this returns the whole table'
  ).toBeDefined();
  return ops[0].clause;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── AC-T0: the hazard ─────────────────────────────────────────────────────────

describe('AC-T0: a report with no resolved owner matches zero rows', () => {
  it.each(CASES)('$name returns nothing rather than every tenant', async (c) => {
    install(c.status);

    // The cast is the point — see the header. Post-fix this state is
    // unreachable through both the type and the route; the call exists to grade
    // the predicate directly.
    const response: any = await c.run(stub, undefined as unknown as string);

    // Pre-fix this is `[APP_ATT, APP_VIC]`: the owner term was not weakened, it
    // was omitted, so the predicate reduced to the status filter.
    expect(c.ids(response)).toEqual([]);
    expect(JSON.stringify(response)).not.toContain('VICTIM_CO');
  });
});

// ── The owner term is unconditional and conjunctive ───────────────────────────

describe('a report with a resolved owner is scoped to that owner', () => {
  it.each(CASES)('$name returns only the caller’s own rows', async (c) => {
    install(c.status);

    const response: any = await c.run(stub, ATTACKER);

    // Behavioural oracle. Under `and`->`or`, or with the owner term dropped,
    // this comes back as both ids and the victim's company reaches the DTO.
    expect(c.ids(response)).toEqual([APP_ATT]);
    expect(JSON.stringify(response)).not.toContain('VICTIM_CO');

    // Structural oracle over the same clause. `extra` supplies the column the
    // report's own filter constrains; a column the probe row does not model
    // reads as UNKNOWN, which resolves permissively, so omitting it could only
    // under-report.
    expectScopedTo(soleApplicationsClause(), {
      table: 'applications',
      userId: ATTACKER,
      extra: { status: c.status },
    });
  });
});
