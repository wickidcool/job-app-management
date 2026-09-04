/**
 * `GET /dashboard` — metric definitions (WIC-1515, AC-T1e).
 *
 * Separate from `dashboard.routes.test.ts` by necessity, not preference:
 * that suite mocks `dashboard.service.js` wholesale to pin the wire contract
 * (WIC-1478), while this one must run the real service against a db stub to
 * measure the metric definitions. `vi.mock` is file-scoped, so the two cannot
 * share a file.
 *
 * There was no dashboard test file at all before this one, which is why both
 * defects it pins shipped and stayed shipped: the "applied this week" count
 * filtered on **current status**, so advancing an application *decremented* the
 * count of applications the user had submitted, and the "this month" window was
 * built with `setMonth(m - 1)`, which overflows short months and silently
 * varied the window between 28 and 31 days depending on the day it was read.
 *
 * The fixture is fixed and the clock is frozen, so every number below is an
 * exact expected value rather than a range.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';
import { getDashboardStats } from '../src/services/dashboard.service.js';
import { aggregateDbStub, type StubRow } from './helpers/aggregate-db-stub.js';
import { DEV_OWNER } from './helpers/local-dev-owner.js';
import { expectScopedTo, renderClause } from './helpers/tenancy.js';

/**
 * The caller that owns the fixture. Every test below passes it to
 * `getDashboardStats` explicitly except the AC-T1e HTTP case, which drives
 * `buildApp()` under the local-dev auth bypass — so since ADR-010 D3 that one
 * reads as `DEV_OWNER` (WIC-1964). Pinning `USER` to the same id keeps the
 * fixture visible on both paths; before D3 the bypass emitted no owner term at
 * all, which is why any id used to work here.
 */
const USER = DEV_OWNER;
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

/**
 * Frozen "now". March 31 is chosen deliberately: it is the date on which the
 * old `setMonth(getMonth() - 1)` overflowed hardest — Feb 31 normalises to
 * March 3, leaving a **28-day** "month".
 */
const NOW = new Date('2026-03-31T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);

/**
 * An `applications` row with every column the service's queries read.
 *
 * `createdAt`/`updatedAt`/`jobDescription` are here for the WIC-1478 attention
 * aggregates, which `getDashboardStats` computes on the same call. They are
 * pinned to the frozen `now` so nothing in these fixtures reads as stale — the
 * attention numbers are pinned by `dashboard.attention-conditions.test.ts`, and
 * letting them vary here would couple these metric assertions to that logic.
 */
function app(over: Partial<StubRow> & { id: string }): StubRow {
  return {
    userId: USER,
    jobTitle: 'Engineer',
    company: 'Acme',
    status: 'saved',
    appliedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    jobDescription: 'A job description.',
    ...over,
  };
}

/**
 * Six applications, all owned by USER:
 *
 * | row | status        | appliedAt | in 7d | in 30d |
 * |-----|---------------|-----------|-------|--------|
 * | a1  | applied       | 2d ago    | yes   | yes    |
 * | a2  | applied       | 2d ago    | yes   | yes    |
 * | a3  | phone_screen  | 2d ago    | yes   | yes    |  <- advanced after applying
 * | a4  | saved         | never     | no    | no     |
 * | a5  | rejected      | 29d ago   | no    | yes    |
 * | a6  | offer         | 45d ago   | no    | no     |
 */
const APPLICATIONS: StubRow[] = [
  app({ id: 'a1', status: 'applied', appliedAt: daysAgo(2) }),
  app({ id: 'a2', status: 'applied', appliedAt: daysAgo(2) }),
  app({ id: 'a3', status: 'phone_screen', appliedAt: daysAgo(2) }),
  app({ id: 'a4', status: 'saved', appliedAt: null }),
  app({ id: 'a5', status: 'rejected', appliedAt: daysAgo(29) }),
  app({ id: 'a6', status: 'offer', appliedAt: daysAgo(45) }),
];

const STATUS_HISTORY: StubRow[] = [
  {
    id: 'h1',
    userId: USER,
    applicationId: 'a3',
    fromStatus: 'applied',
    toStatus: 'phone_screen',
    changedAt: daysAgo(1),
  },
  {
    id: 'h2',
    userId: USER,
    applicationId: 'a1',
    fromStatus: null,
    toStatus: 'applied',
    changedAt: daysAgo(2),
  },
];

function install(fixtures: Record<string, StubRow[]>) {
  const stub = aggregateDbStub(fixtures);
  vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);
  return stub;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getDb).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /dashboard — fixed fixture (AC-T1e)', () => {
  it('returns the exact stats the fixture implies', async () => {
    install({ applications: APPLICATIONS, status_history: STATUS_HISTORY });

    const res = await buildApp().request('/api/dashboard', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: {
        total: number;
        byStatus: Record<string, number>;
        appliedThisWeek: number;
        appliedThisMonth: number;
        responseRate: number;
      };
      recentActivity: unknown[];
    };

    // AC-T2b — three applications were submitted inside the window and one of
    // them has since advanced to `phone_screen`. The count is 3, not 2.
    expect(body.stats.appliedThisWeek).toBe(3);

    // a1 + a2 + a3 (2d) + a5 (29d). a4 was never submitted; a6 is 45d old.
    expect(body.stats.appliedThisMonth).toBe(4);

    // responded = phone_screen 1 + interview 0 + offer 1 + rejected 1 = 3
    // totalApplied = applied 2 + 3                                    = 5
    expect(body.stats.responseRate).toBe(0.6);

    expect(body.stats.total).toBe(6);
    expect(body.stats.byStatus).toEqual({
      saved: 1,
      applied: 2,
      phone_screen: 1,
      interview: 0,
      offer: 1,
      rejected: 1,
      withdrawn: 0,
    });

    // The join resolves, newest first.
    expect(body.recentActivity).toHaveLength(2);
    expect(body.recentActivity[0]).toMatchObject({
      applicationId: 'a3',
      jobTitle: 'Engineer',
      company: 'Acme',
      action: 'status_changed',
      fromStatus: 'applied',
      toStatus: 'phone_screen',
    });
    expect(body.recentActivity[1]).toMatchObject({
      applicationId: 'a1',
      action: 'created',
      toStatus: 'applied',
    });
  });
});

describe('appliedThisWeek counts submissions, not current status (AC-T2a/AC-T2b)', () => {
  it('does not fall when an application progresses', async () => {
    // Exactly the card's failure scenario, isolated: three submissions on the
    // same day, then one of them advances.
    const before: StubRow[] = [
      app({ id: 'p1', status: 'applied', appliedAt: daysAgo(2) }),
      app({ id: 'p2', status: 'applied', appliedAt: daysAgo(2) }),
      app({ id: 'p3', status: 'applied', appliedAt: daysAgo(2) }),
    ];
    install({ applications: before, status_history: [] });
    const monday = await getDashboardStats(USER);
    expect(monday.stats.appliedThisWeek).toBe(3);

    // Tuesday: an employer schedules a screen. `appliedAt` is preserved.
    const after = before.map((r) => (r.id === 'p3' ? { ...r, status: 'phone_screen' } : r));
    install({ applications: after, status_history: [] });
    const tuesday = await getDashboardStats(USER);

    expect(tuesday.stats.appliedThisWeek).toBe(3);
    expect(tuesday.stats.appliedThisWeek).toBe(monday.stats.appliedThisWeek);
  });

  it('counts every post-submission status, including terminal ones', async () => {
    install({
      applications: [
        app({ id: 'q1', status: 'applied', appliedAt: daysAgo(1) }),
        app({ id: 'q2', status: 'phone_screen', appliedAt: daysAgo(1) }),
        app({ id: 'q3', status: 'interview', appliedAt: daysAgo(1) }),
        app({ id: 'q4', status: 'offer', appliedAt: daysAgo(1) }),
        app({ id: 'q5', status: 'rejected', appliedAt: daysAgo(1) }),
        app({ id: 'q6', status: 'withdrawn', appliedAt: daysAgo(1) }),
      ],
      status_history: [],
    });

    const { stats } = await getDashboardStats(USER);
    expect(stats.appliedThisWeek).toBe(6);
  });

  it('excludes applications that were never submitted', async () => {
    // `saved` rows carry a NULL `applied_at`; `NULL >= $1` is UNKNOWN, so they
    // fall out of the window rather than being counted as submissions.
    install({
      applications: [
        app({ id: 'r1', status: 'saved', appliedAt: null }),
        app({ id: 'r2', status: 'saved', appliedAt: null }),
        app({ id: 'r3', status: 'applied', appliedAt: daysAgo(1) }),
      ],
      status_history: [],
    });

    const { stats } = await getDashboardStats(USER);
    expect(stats.appliedThisWeek).toBe(1);
  });

  it('excludes submissions older than the 7-day window', async () => {
    install({
      applications: [
        app({ id: 's1', status: 'applied', appliedAt: daysAgo(6) }),
        app({ id: 's2', status: 'applied', appliedAt: daysAgo(8) }),
      ],
      status_history: [],
    });

    const { stats } = await getDashboardStats(USER);
    expect(stats.appliedThisWeek).toBe(1);
  });
});

describe('appliedThisMonth is a fixed rolling 30 days (AC-T2c)', () => {
  // One row just inside a 30-day window and one just outside it. A correct
  // window answers "1" on every date; the old `setMonth` window answered 1 on
  // May 31 and 0 on March 31, because Feb 31 normalised forward to March 3.
  const window: StubRow[] = [
    app({ id: 'm1', status: 'applied', appliedAt: null }),
    app({ id: 'm2', status: 'applied', appliedAt: null }),
  ];

  const at = (iso: string): StubRow[] => {
    const now = new Date(iso).getTime();
    return [
      { ...window[0], appliedAt: new Date(now - 29 * DAY_MS) },
      { ...window[1], appliedAt: new Date(now - 31 * DAY_MS) },
    ];
  };

  // March 31 is the 28-day case; May 31 is the 30-day case; Jan 31 normalises
  // through a short February too. A single expected value across all three is
  // the assertion — the window must not depend on the day it is read.
  it.each([
    ['2026-03-31T12:00:00.000Z'],
    ['2026-05-31T12:00:00.000Z'],
    ['2026-01-31T12:00:00.000Z'],
    ['2026-07-15T12:00:00.000Z'],
  ])('is exactly 30 days when read on %s', async (iso) => {
    vi.setSystemTime(new Date(iso));
    install({ applications: at(iso), status_history: [] });

    const { stats } = await getDashboardStats(USER);
    expect(stats.appliedThisMonth).toBe(1);
  });

  it('has a window at least as wide as the week window on every date', async () => {
    install({ applications: APPLICATIONS, status_history: STATUS_HISTORY });
    const { stats } = await getDashboardStats(USER);
    expect(stats.appliedThisMonth).toBeGreaterThanOrEqual(stats.appliedThisWeek);
  });
});

describe('the window metrics stay scoped to the caller', () => {
  it('does not count another user submissions', async () => {
    install({
      applications: [
        app({ id: 'o1', status: 'applied', appliedAt: daysAgo(1) }),
        app({ id: 'o2', status: 'applied', appliedAt: daysAgo(1), userId: OTHER_USER }),
        app({ id: 'o3', status: 'applied', appliedAt: daysAgo(1), userId: null }),
      ],
      status_history: [],
    });

    const { stats } = await getDashboardStats(USER);
    expect(stats.appliedThisWeek).toBe(1);
    expect(stats.appliedThisMonth).toBe(1);
  });

  it('binds the owner term on both window reads', async () => {
    // Dropping `eq(status, 'applied')` rewrote both `and(...)` clauses, so the
    // owner term is re-asserted structurally rather than assumed to have
    // survived the edit.
    const stub = install({ applications: APPLICATIONS, status_history: STATUS_HISTORY });
    await getDashboardStats(USER);

    const windowed = stub
      .clausesOn('applications')
      .filter((c) => /"applications"\."applied_at"/.test(renderClause(c).sql));

    expect(
      windowed.length,
      'expected exactly the week and month reads to carry a date-window term'
    ).toBe(2);

    // `expectScopedTo` does not model `>=`, so the window term evaluates to
    // UNKNOWN there and the assertion rests entirely on the owner term — which
    // is precisely what is being checked here.
    for (const clause of windowed) {
      expectScopedTo(clause, { table: 'applications', userId: USER });
    }
  });
});
