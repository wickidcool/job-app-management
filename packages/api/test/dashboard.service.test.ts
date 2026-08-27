/**
 * WIC-1574 — executable coverage for `getDashboardStats`'s `attention` block.
 *
 * WIC-1478 shipped ~167 lines of aggregate SQL that nothing executed.
 * `dashboard.routes.test.ts` opens with `vi.mock('../src/services/dashboard.service.js')`,
 * so it pins the route's JSON pass-through and nothing below it;
 * `packages/web/src/pages/Dashboard.attention.test.tsx` computes its own expected
 * counts and feeds them to a `fetch` stub. Both layers were green while the number
 * they agree on was a literal in a fixture.
 *
 * ## Why a real Postgres and not a stub
 *
 * Every defect this file exists to catch is a **predicate** defect — a comparison
 * flipped, a status list narrowed, a `LIMIT` applied to a `count(*)`, an owner term
 * dropped. A hand-rolled `stubDb` resolves whatever rows it was primed with
 * *regardless of the predicate it was handed*, so it certifies all six mutations as
 * passing. WIC-1373 already shipped two tenancy assertions that passed **with** the
 * bug in place for exactly this reason, and WIC-1449 re-learned it. Only a real
 * planner can tell `updated_at < $1` from `updated_at > $1`.
 *
 * PGlite is the same harness `project.tenancy.test.ts`, `extraction.tenancy.test.ts`
 * and `foreign-star-audit.predicate.test.ts` use. It is deliberately inlined here
 * rather than extracted to a shared helper: all three of those live on unmerged
 * branches, and a fourth divergent copy of a shared file is worse than a fourth
 * inline harness. Extract once one of them lands.
 *
 * ## Grading bar — the six mutations from the card, each applied alone
 *
 * | | mutation to `dashboard.service.ts`                        | caught by |
 * |---|---------------------------------------------------------|-----------|
 * | A | stale predicate `lt` → `gt`                              | `stale counts rows NOT touched for STALE_THRESHOLD_DAYS` |
 * | B | `staleCondition` `NON_TERMINAL_STATUSES` → `ACTIVE_STATUSES` | `stale spans saved; staleActive excludes it` |
 * | C | `staleActive` sample order `asc` → `desc`                | `staleActive sample leads with the most stale row` |
 * | D | `countMatching` bounded by `ATTENTION_SAMPLE_LIMIT`      | `AC-N1c: counts are full-table, samples are bounded` |
 * | E | `userFilter` dropped from `countMatching`                | `counts are scoped to the caller` |
 * | F | `interviewing` drops `phone_screen`                      | `interviewing sample spans both interviewing statuses` |
 *
 * D and E are the two that matter. D *is* WIC-1478's own defect re-implemented
 * server-side — bound the counts by the sample limit and the Dashboard goes quietly
 * blind again. E leaks another user's counts (the WIC-1554 `userId: null` class).
 *
 * ## Four more cells, added in review — the "indistinguishable pair" axis
 *
 * The first revision of this file passed A–F but was blind to four mutations that
 * swap one member of a pair the typechecker cannot separate, because no fixture row
 * made the pair disagree:
 *
 * | | mutation to `dashboard.service.ts`                        | caught by |
 * |---|---------------------------------------------------------|-----------|
 * | I1 | `staleCondition` reads `savedThreshold` (3d), not `staleThreshold` (7d) | the two `counts.stale` assertions |
 * | I2 | same swap on `staleActiveCondition`                     | `stale spans saved; staleActive excludes it` |
 * | J | `staleCondition` keys off `createdAt`, not `updatedAt`   | the two `counts.stale` assertions |
 * | N | `staleActive` sample orders by `createdAt`, not `updatedAt` | `staleActive sample leads with the most stale row` |
 *
 * Two rows close all four. `applied-5d` sits in the (3, 7)-day gap that nothing
 * previously occupied, so the two `Date`s stop being interchangeable. `applied-stale-
 * born-yesterday` is the only row here whose `createdAt` and `updatedAt` disagree,
 * which is what makes the column choice observable at all. Both are inert under
 * correct code — one is fresh, one is stale-and-active exactly as the bucket intends.
 *
 * Keep that property when editing `FIXTURE`: a row is worth adding when some mutation
 * moves it across a boundary, and worth keeping only while it still does.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

let db: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock('../src/db/client.js', () => ({
  // Lazy: `db` is assigned in beforeAll, long after this factory is hoisted.
  getDb: () => db,
  closeDb: async () => {},
}));

const { getDashboardStats, STALE_THRESHOLD_DAYS, SAVED_THRESHOLD_DAYS } =
  await import('../src/services/dashboard.service.js');
const { applications } = await import('../src/db/schema.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

/** Mirrors `db/schema.ts`. `applications.user_id` is NOT in migration 0017's
 *  NOT NULL list, so it stays nullable here — that is what makes the unscoped
 *  call path in the last describe reachable at all. */
const SCHEMA_DDL = `
CREATE TYPE app_status AS ENUM (
  'saved','applied','phone_screen','interview','offer','rejected','withdrawn'
);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  user_id UUID,
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  url TEXT,
  location TEXT,
  salary_range TEXT,
  status app_status NOT NULL DEFAULT 'saved',
  cover_letter_id TEXT,
  resume_version_id TEXT,
  applied_at TIMESTAMPTZ,
  contact TEXT,
  comp_target TEXT,
  next_action TEXT,
  next_action_due DATE,
  job_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE status_history (
  id TEXT PRIMARY KEY,
  user_id UUID,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status app_status,
  to_status app_status NOT NULL,
  note TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number, offsetMs = 0) => new Date(Date.now() - n * DAY_MS - offsetMs);

type Seed = {
  id: string;
  userId?: string | null;
  status: string;
  updatedAt: Date;
  createdAt?: Date;
  jobDescription?: string | null;
};

async function seed(rows: Seed[]) {
  await db.insert(applications).values(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId === undefined ? USER_A : r.userId,
      jobTitle: `Engineer ${r.id}`,
      company: `Company ${r.id}`,
      status: r.status as never,
      jobDescription: r.jobDescription === undefined ? 'a real description' : r.jobDescription,
      createdAt: r.createdAt ?? r.updatedAt,
      updatedAt: r.updatedAt,
    }))
  );
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await client.exec(SCHEMA_DDL);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec('TRUNCATE applications CASCADE;');
});

describe('getDashboardStats — attention counts are full-table', () => {
  /**
   * AC-N1c, reproduced against a real engine: 150 applications, 40 of them stale.
   * The client only ever holds a page of 50, which is the whole reason these
   * aggregates moved server-side.
   *
   * Kills D (`countMatching` bounded by ATTENTION_SAMPLE_LIMIT ⇒ 2) and
   * A (`lt` → `gt` ⇒ 110).
   */
  it('AC-N1c: counts are full-table, samples are bounded', async () => {
    const rows: Seed[] = [];
    // 40 stale: all ~30 days old, spread by a minute so ordering is deterministic.
    for (let i = 0; i < 40; i++) {
      rows.push({
        id: `stale-${String(i).padStart(2, '0')}`,
        status: 'applied',
        updatedAt: daysAgo(30, i * 60_000),
      });
    }
    // 110 fresh, well inside the threshold.
    for (let i = 0; i < 110; i++) {
      rows.push({
        id: `fresh-${String(i).padStart(3, '0')}`,
        status: 'applied',
        updatedAt: daysAgo(1),
      });
    }
    await seed(rows);

    const { stats, attention } = await getDashboardStats(USER_A);

    expect(stats.total).toBe(150);
    // The headline: 40, not 2 and not 110.
    expect(attention.counts.stale).toBe(40);
    expect(attention.counts.staleActive).toBe(40);
    // ...while the sample beside it stays bounded. Both numbers, together, are
    // the assertion — either one alone is satisfied by a mutation.
    expect(attention.samples.staleActive).toHaveLength(2);
    expect(attention.staleThresholdDays).toBe(STALE_THRESHOLD_DAYS);
  });

  it('counts survive well past the 50-row page the client can see', async () => {
    const rows: Seed[] = [];
    for (let i = 0; i < 137; i++) {
      rows.push({
        id: `saved-${String(i).padStart(3, '0')}`,
        status: 'saved',
        updatedAt: daysAgo(30, i * 60_000),
        createdAt: daysAgo(30, i * 60_000),
      });
    }
    await seed(rows);

    const { attention } = await getDashboardStats(USER_A);

    expect(attention.counts.staleSaved).toBe(137);
    expect(attention.samples.staleSaved).toHaveLength(2);
    expect(attention.savedThresholdDays).toBe(SAVED_THRESHOLD_DAYS);
  });
});

describe('getDashboardStats — attention predicates', () => {
  /**
   * One fixture, exercised from several angles. Every row is here because some
   * mutation moves it across a boundary.
   */
  const FIXTURE: Seed[] = [
    // Stale and non-terminal, but `saved` — in `stale`, out of `staleActive`.
    { id: 'saved-old', status: 'saved', updatedAt: daysAgo(30), createdAt: daysAgo(30) },
    // The most stale *active* row. The `staleActive` sample must lead with it.
    { id: 'applied-oldest', status: 'applied', updatedAt: daysAgo(30) },
    // Stale and active, but newer than the one above.
    { id: 'interview-newer', status: 'interview', updatedAt: daysAgo(10) },
    // Fresh — inside the threshold, so stale by no definition.
    { id: 'applied-fresh', status: 'applied', updatedAt: daysAgo(1) },
    // Terminal and old: excluded from every stale bucket.
    { id: 'rejected-old', status: 'rejected', updatedAt: daysAgo(30) },
    { id: 'offer-old', status: 'offer', updatedAt: daysAgo(30) },
    { id: 'withdrawn-old', status: 'withdrawn', updatedAt: daysAgo(30) },
    // Interviewing, both statuses, fresh so they touch no stale bucket.
    { id: 'phone-screen-fresh', status: 'phone_screen', updatedAt: daysAgo(2) },
    // Aged into the gap BETWEEN the two thresholds: older than SAVED (3d), newer
    // than STALE (7d). Not stale. Present so the stale predicates cannot quietly
    // read `savedThreshold` — the two Dates are declared four lines apart and are
    // interchangeable to the typechecker, and with no row in this window the swap
    // is invisible while the payload still reports `staleThresholdDays: 7`.
    { id: 'applied-5d', status: 'applied', updatedAt: daysAgo(5) },
    // Stale by `updatedAt` but brand new by `createdAt`. The mirror of the
    // `staleSaved keys off createdAt` case below: it is the only row in this
    // fixture where the two columns disagree, so it is the only thing standing
    // between `stale` and a silent rewrite onto `createdAt` — and, because it
    // sorts between the other two active rows by one column and last by the
    // other, between the sample's `orderBy` and the same rewrite.
    {
      id: 'applied-stale-born-yesterday',
      status: 'applied',
      updatedAt: daysAgo(20),
      createdAt: daysAgo(1),
    },
  ];

  beforeEach(() => seed(FIXTURE));

  /** Kills A: under `gt`, `stale` becomes the fresh rows instead. */
  it('stale counts rows NOT touched for STALE_THRESHOLD_DAYS', async () => {
    const { attention } = await getDashboardStats(USER_A);

    // saved-old + applied-oldest + interview-newer + applied-stale-born-yesterday.
    // Not applied-fresh, not phone-screen-fresh, not applied-5d (inside the 7-day
    // threshold, though outside the 3-day one), and none of the three terminal rows.
    expect(attention.counts.stale).toBe(4);
    expect(ids(attention.samples.staleActive)).not.toContain('applied-fresh');
  });

  /** Kills B: scoping `stale` to ACTIVE_STATUSES collapses it onto `staleActive`. */
  it('stale spans saved; staleActive excludes it', async () => {
    const { attention } = await getDashboardStats(USER_A);

    expect(attention.counts.stale).toBe(4); // incl. saved-old
    expect(attention.counts.staleActive).toBe(3); // excl. saved-old
    // The strict containment is the property; equality means the scopes merged.
    expect(attention.counts.stale).toBeGreaterThan(attention.counts.staleActive);
    expect(ids(attention.samples.staleActive)).not.toContain('saved-old');
  });

  /**
   * Kills C: `asc` → `desc` puts the 10-day row first.
   * Kills N: `applied-stale-born-yesterday` is second by `updatedAt` (20d) but last
   * by `createdAt` (1d), so ordering on the wrong column drops it from the sample.
   */
  it('staleActive sample leads with the most stale row', async () => {
    const { attention } = await getDashboardStats(USER_A);

    expect(ids(attention.samples.staleActive)).toEqual([
      'applied-oldest',
      'applied-stale-born-yesterday',
    ]);
  });

  /** Kills F: dropping `phone_screen` from INTERVIEWING_STATUSES empties it from the sample. */
  it('interviewing sample spans both interviewing statuses', async () => {
    await seed([{ id: 'interview-fresh', status: 'interview', updatedAt: daysAgo(3) }]);

    const { attention } = await getDashboardStats(USER_A);

    const sampled = ids(attention.samples.interviewing);
    expect(sampled).toContain('phone-screen-fresh');
    expect(sampled).toContain('interview-fresh');
    // `counts.interviewing` is byStatus-derived rather than re-queried; assert the
    // two agree so they cannot silently drift apart.
    expect(attention.counts.interviewing).toBe(3); // phone-screen-fresh + 2 interviews
  });

  it('staleSaved keys off createdAt, not updatedAt', async () => {
    await seed([
      // Created long ago but touched today: still not-yet-submitted, so it counts.
      { id: 'saved-touched', status: 'saved', updatedAt: daysAgo(0), createdAt: daysAgo(30) },
      // Created today: inside the saved threshold.
      { id: 'saved-new', status: 'saved', updatedAt: daysAgo(0), createdAt: daysAgo(0) },
    ]);

    const { attention } = await getDashboardStats(USER_A);

    expect(attention.counts.staleSaved).toBe(2); // saved-old + saved-touched
    expect(ids(attention.samples.staleSaved)).not.toContain('saved-new');
  });

  /**
   * The aggregate replaced a client-side `!app.jobDescription`. Whitespace is the
   * interesting cell: `!'   '` is `false` in JS, and `'   ' = ''` is false in SQL,
   * so the two agree — a `trim()`-based rewrite would silently disagree.
   */
  it('missingJobDescription matches NULL and empty, not whitespace or text', async () => {
    await seed([
      { id: 'desc-null', status: 'applied', updatedAt: daysAgo(1), jobDescription: null },
      { id: 'desc-empty', status: 'applied', updatedAt: daysAgo(1), jobDescription: '' },
      { id: 'desc-blank', status: 'applied', updatedAt: daysAgo(1), jobDescription: '   ' },
      { id: 'desc-text', status: 'applied', updatedAt: daysAgo(1), jobDescription: 'real' },
      // Terminal rows are out of scope even with no description at all.
      { id: 'desc-null-rejected', status: 'rejected', updatedAt: daysAgo(1), jobDescription: null },
    ]);

    const { attention } = await getDashboardStats(USER_A);

    expect(attention.counts.missingJobDescription).toBe(2);
    const sampled = ids(attention.samples.missingJobDescription);
    expect(sampled).not.toContain('desc-blank');
    expect(sampled).not.toContain('desc-text');
    expect(sampled).not.toContain('desc-null-rejected');
  });
});

describe('getDashboardStats — attention is scoped to the caller', () => {
  /**
   * Kills E. User B deliberately holds *more* matching rows than A in every
   * category, so a dropped `userFilter` cannot coincide with the right answer.
   *
   * The counts and the samples are asserted separately on purpose: `countMatching`
   * and `sampleMatching` carry their own `userFilter`, so a mutation to one must
   * name that one. Asserting only "no B ids in the samples" would leave
   * `countMatching`'s owner term untested — which is precisely mutation E.
   */
  beforeEach(() =>
    seed([
      // ---- user A: exactly one row in each bucket ----
      { id: 'a-stale', userId: USER_A, status: 'applied', updatedAt: daysAgo(30) },
      {
        id: 'a-saved',
        userId: USER_A,
        status: 'saved',
        updatedAt: daysAgo(30),
        createdAt: daysAgo(30),
      },
      {
        id: 'a-nodesc',
        userId: USER_A,
        status: 'applied',
        updatedAt: daysAgo(1),
        jobDescription: null,
      },
      { id: 'a-interview', userId: USER_A, status: 'interview', updatedAt: daysAgo(1) },
      // ---- user B: three rows in each bucket ----
      ...[0, 1, 2].flatMap((i): Seed[] => [
        {
          id: `b-stale-${i}`,
          userId: USER_B,
          status: 'applied',
          updatedAt: daysAgo(30, i * 60_000),
        },
        {
          id: `b-saved-${i}`,
          userId: USER_B,
          status: 'saved',
          updatedAt: daysAgo(30),
          createdAt: daysAgo(30, i * 60_000),
        },
        {
          id: `b-nodesc-${i}`,
          userId: USER_B,
          status: 'applied',
          updatedAt: daysAgo(1),
          jobDescription: null,
        },
        { id: `b-interview-${i}`, userId: USER_B, status: 'interview', updatedAt: daysAgo(1) },
      ]),
    ])
  );

  it('counts are scoped to the caller', async () => {
    const { stats, attention } = await getDashboardStats(USER_A);

    expect(stats.total).toBe(4);
    // Every one of these is 4 if `countMatching` loses its owner term.
    expect(attention.counts.stale).toBe(2); // a-stale + a-saved
    expect(attention.counts.staleActive).toBe(1); // a-stale
    expect(attention.counts.staleSaved).toBe(1); // a-saved
    expect(attention.counts.missingJobDescription).toBe(1); // a-nodesc
    expect(attention.counts.interviewing).toBe(1); // a-interview
  });

  it('samples never carry another owner’s rows', async () => {
    const { attention } = await getDashboardStats(USER_A);

    const sampled = [
      ...attention.samples.interviewing,
      ...attention.samples.staleActive,
      ...attention.samples.missingJobDescription,
      ...attention.samples.staleSaved,
    ];
    expect(sampled.length).toBeGreaterThan(0);
    // Anchored: assert the owner, not merely the absence of a known-bad id.
    // `undefined` reads as "matches everything", so an id-shaped oracle that
    // silently matched nothing would certify a leak (WIC-1518).
    for (const row of sampled) {
      expect(row.id.startsWith('a-')).toBe(true);
    }
    expect(ids(attention.samples.staleActive)).toEqual(['a-stale']);
  });

  it('user B sees its own aggregates, not A’s', async () => {
    const { attention } = await getDashboardStats(USER_B);

    expect(attention.counts.stale).toBe(6); // 3 applied + 3 saved
    expect(attention.counts.staleActive).toBe(3);
    expect(attention.counts.staleSaved).toBe(3);
    expect(attention.counts.missingJobDescription).toBe(3);
  });

  /**
   * Documents the unscoped call path — it is NOT an endorsement of it.
   *
   * `getDashboardStats()` takes `userId?`, and `userId ? eq(...) : undefined`
   * makes an absent caller read the whole table. That is the WIC-1554
   * `sub`-less-JWT `userId: null` class, and `applications.user_id` is nullable
   * (migration 0017 does not cover this table), so the row shape is reachable.
   *
   * When WIC-1554 lands, this expectation should INVERT — an absent identity
   * should reach no rows rather than all of them. Failing here is the signal
   * that the fix arrived, not that this test broke.
   */
  it('called with no userId, aggregates across every tenant (WIC-1554, fail-open)', async () => {
    const { stats, attention } = await getDashboardStats();

    expect(stats.total).toBe(16); // 4 of A's + 12 of B's
    expect(attention.counts.stale).toBe(8);
    expect(attention.counts.staleActive).toBe(4);
  });
});
