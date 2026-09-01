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
 * | C | `stale` sample order `asc` → `desc`                      | `stale sample leads with the most stale row` |
 * | D | `countMatching` bounded by `ATTENTION_SAMPLE_LIMIT`      | `AC-N1c: counts are full-table, samples are bounded` |
 * | E | `userFilter` dropped from `countMatching`                | `counts are scoped to the caller` |
 * | F | `interviewing` drops `phone_screen`                      | `interviewing sample spans both interviewing statuses` |
 *
 * D and E are the two that matter. D *is* WIC-1478's own defect re-implemented
 * server-side — bound the counts by the sample limit and the Dashboard goes quietly
 * blind again. E leaks another user's counts (the WIC-1554 `userId: null` class).
 *
 * **A and B retired here (WIC-1479).** They mutated the `lt`/status-list literals
 * `buildAttentionConditions` used to build `staleCondition` locally. That
 * predicate is now `staleWhere()`, whole, imported from `stale.ts` — this file no
 * longer holds the literals A and B mutated, so it cannot grade them. Both live
 * on, unchanged in spirit, as `stale.definition.test.ts`'s job: it owns
 * `staleWhere`/`isStale` and mutation-tests the comparison direction and status
 * set directly against the one place they are now declared. What this file still
 * owns is that `getDashboardStats` *wires* that predicate through correctly —
 * scoped by owner (E), bounded on samples but not counts (D), ordered right (C).
 *
 * ## Two more cells — the "indistinguishable pair" axis, on the surviving predicate
 *
 * `staleCondition` no longer has a sibling `staleActiveCondition` to confuse it
 * with (WIC-1479 merged the two: the unified definition is `applied`/
 * `phone_screen` only, so a separate "active" subset is the same set). The pair
 * this file can still confuse is the sample's sort column:
 *
 * | | mutation to `dashboard.service.ts`                        | caught by |
 * |---|---------------------------------------------------------|-----------|
 * | N | `stale` sample orders by `createdAt`, not `updatedAt`    | `stale sample leads with the most stale row` |
 *
 * `applied-stale-born-yesterday` is the row that closes N: stale by `updatedAt`
 * (20d) but created yesterday, so it is the only row in the fixture where the two
 * columns disagree — which is what makes the sort column observable at all.
 *
 * ## Three more, on `unsubmittedSaved` (`staleSaved` pre-WIC-1479)
 *
 * `unsubmittedSavedCondition` is still built locally in `dashboard.service.ts` —
 * WIC-1479 only extracted the `stale` bucket to `staleWhere()`, because
 * "unsubmitted" is explicitly not staleness (§ the module's own comment). So its
 * threshold-confusion and column-confusion mutations are still this file's to
 * catch:
 *
 * | | mutation to `dashboard.service.ts`                        | caught by |
 * |---|---------------------------------------------------------|-----------|
 * | R | `unsubmittedSavedCondition` reads a 14d threshold, not `UNSUBMITTED_THRESHOLD_DAYS` (3d) | `unsubmittedSaved keys off createdAt, and against the 3-day threshold` |
 * | S | `unsubmittedSavedCondition` keys off `updatedAt`, not `createdAt` | the same cell, and the ordering cell below |
 * | U | `unsubmittedSaved` sample orders by `updatedAt`, not `createdAt` | `unsubmittedSaved sample is ordered by createdAt, not updatedAt` |
 *
 * `saved-created-5d` is the one row that closes R and U: it is `saved` (so it
 * reaches the bucket), created into the (3, 14)-day window (so the threshold
 * choice moves it), and disagrees between its two columns (so the ordering choice
 * moves it). Inert under correct code — it is unsubmitted-and-saved exactly as
 * intended.
 *
 * Note `unsubmittedSaved` now counts 3, which is above `ATTENTION_SAMPLE_LIMIT`,
 * so D reds these cells too. D was already a blanket mutation, so no
 * discrimination is lost.
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

const { getDashboardStats, UNSUBMITTED_THRESHOLD_DAYS } = await import(
  '../src/services/dashboard.service.js'
);
const { DEFAULT_STALE_THRESHOLD_DAYS } = await import('../src/services/stale.js');
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
    // ...while the sample beside it stays bounded. Both numbers, together, are
    // the assertion — either one alone is satisfied by a mutation.
    expect(attention.samples.stale).toHaveLength(2);
    expect(attention.staleThresholdDays).toBe(DEFAULT_STALE_THRESHOLD_DAYS);
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

    expect(attention.counts.unsubmittedSaved).toBe(137);
    expect(attention.samples.unsubmittedSaved).toHaveLength(2);
    expect(attention.unsubmittedThresholdDays).toBe(UNSUBMITTED_THRESHOLD_DAYS);
  });
});

describe('getDashboardStats — attention predicates', () => {
  /**
   * One fixture, exercised from several angles. Every row is here because some
   * mutation moves it across a boundary.
   */
  const FIXTURE: Seed[] = [
    // Wrong status for `stale` (WIC-1479: `applied`/`phone_screen` only), but
    // old enough that it would wrongly qualify if the status filter were
    // dropped. Still reaches `unsubmittedSaved` on its `createdAt`.
    { id: 'saved-old', status: 'saved', updatedAt: daysAgo(30), createdAt: daysAgo(30) },
    // The most stale row of the surviving population. The `stale` sample must
    // lead with it.
    { id: 'applied-oldest', status: 'applied', updatedAt: daysAgo(30) },
    // Wrong status for `stale` (interview is excluded, unlike pre-WIC-1479),
    // but old enough — 20d — that it would wrongly qualify if the status
    // filter were dropped rather than merely narrowed.
    { id: 'interview-newer', status: 'interview', updatedAt: daysAgo(20) },
    // Right status, inside the 14-day threshold: fresh, so stale by no definition.
    { id: 'applied-fresh', status: 'applied', updatedAt: daysAgo(1) },
    // Terminal and old: excluded from every stale bucket.
    { id: 'rejected-old', status: 'rejected', updatedAt: daysAgo(30) },
    { id: 'offer-old', status: 'offer', updatedAt: daysAgo(30) },
    { id: 'withdrawn-old', status: 'withdrawn', updatedAt: daysAgo(30) },
    // Right status, still fresh.
    { id: 'phone-screen-fresh', status: 'phone_screen', updatedAt: daysAgo(2) },
    // Right status, inside the 14-day threshold (5d), so still fresh — the
    // 3-day `UNSUBMITTED_THRESHOLD_DAYS` is a different bucket's threshold
    // entirely and does not apply to a non-`saved` status.
    { id: 'applied-5d', status: 'applied', updatedAt: daysAgo(5) },
    // Stale by `updatedAt` (20d) but created yesterday. The only row in this
    // fixture where the two columns disagree, so it is the only thing standing
    // between `stale` and a silent rewrite onto `createdAt` — and, because it
    // sorts between `applied-oldest` by one column and last by the other,
    // between the sample's `orderBy` and the same rewrite.
    {
      id: 'applied-stale-born-yesterday',
      status: 'applied',
      updatedAt: daysAgo(20),
      createdAt: daysAgo(1),
    },
    // Third row past the 14-day threshold, so the sample (limit 2) has a real
    // choice to make: correctly ranked 3rd (least stale of the three) by
    // `updatedAt`, but created long before either — so ordering by `createdAt`
    // instead would rank it 1st and push `applied-stale-born-yesterday` out.
    {
      id: 'applied-stale-fresher',
      status: 'applied',
      updatedAt: daysAgo(15),
      createdAt: daysAgo(40),
    },
    // The `unsubmittedSaved` mirror of `applied-stale-born-yesterday` above,
    // and the reason it has to be separate: `unsubmittedSavedCondition`
    // requires `status = 'saved'`, so an `applied` row never enters that
    // bucket and the property it pins is not observable there. Created into
    // the (3, 14)-day window, so
    // reading a 14-day threshold here instead of `UNSUBMITTED_THRESHOLD_DAYS`
    // drops it; last by `createdAt` but second by `updatedAt`, so ordering on
    // the wrong column pulls it into the sample.
    {
      id: 'saved-created-5d',
      status: 'saved',
      updatedAt: daysAgo(20),
      createdAt: daysAgo(5),
    },
  ];

  beforeEach(() => seed(FIXTURE));

  /**
   * Confirms `stale` is wired to `staleWhere()`'s real definition end to end —
   * `applied`/`phone_screen` only, past the 14-day threshold, keyed on
   * `updatedAt` — against a real query rather than the unit-level coverage
   * `stale.definition.test.ts` already has for the predicate itself.
   */
  it('stale counts only applied/phone_screen rows past the 14-day threshold', async () => {
    const { attention } = await getDashboardStats(USER_A);

    // applied-oldest + applied-stale-born-yesterday + applied-stale-fresher.
    // Not saved-old or interview-newer, despite both being 20-30 days old — wrong
    // status. Not applied-fresh, phone-screen-fresh or applied-5d — right status,
    // too fresh. Not saved-created-5d — wrong status. None of the three terminal rows.
    expect(attention.counts.stale).toBe(3);
    // ...while the sample beside it stays bounded at 2 — the same D property
    // `AC-N1c` pins at larger scale, exercised here alongside the status filter.
    expect(attention.samples.stale).toHaveLength(2);
    expect(ids(attention.samples.stale)).not.toContain('applied-fresh');
    expect(ids(attention.samples.stale)).not.toContain('saved-old');
    expect(ids(attention.samples.stale)).not.toContain('interview-newer');
  });

  /**
   * Kills C: `asc` → `desc` puts `applied-stale-fresher` (15d, least stale of
   * the three) first instead of last.
   * Kills N: `applied-stale-born-yesterday` is second by `updatedAt` (20d) but last
   * by `createdAt` (1d), so ordering on the wrong column drops it from the sample.
   */
  it('stale sample leads with the most stale row', async () => {
    const { attention } = await getDashboardStats(USER_A);

    expect(ids(attention.samples.stale)).toEqual(['applied-oldest', 'applied-stale-born-yesterday']);
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

  /**
   * Kills S: keying off `updatedAt` drops saved-touched (touched today) and admits
   * nothing to replace it.
   * Kills R: reading a 14-day threshold instead of `UNSUBMITTED_THRESHOLD_DAYS`
   * (3d) drops saved-created-5d, which sits in the gap between the two.
   */
  it('unsubmittedSaved keys off createdAt, and against the 3-day threshold', async () => {
    await seed([
      // Created long ago but touched today: still not-yet-submitted, so it counts.
      { id: 'saved-touched', status: 'saved', updatedAt: daysAgo(0), createdAt: daysAgo(25) },
      // Created today: inside the unsubmitted threshold.
      { id: 'saved-new', status: 'saved', updatedAt: daysAgo(0), createdAt: daysAgo(0) },
    ]);

    const { attention } = await getDashboardStats(USER_A);

    // saved-old + saved-touched + saved-created-5d.
    expect(attention.counts.unsubmittedSaved).toBe(3);
    expect(ids(attention.samples.unsubmittedSaved)).not.toContain('saved-new');
  });

  /**
   * Kills U: the sample is `asc(createdAt)` limit 2, so the two oldest-created rows
   * take it and saved-created-5d is left out. Ordering by `updatedAt` instead puts
   * it second (20d, behind saved-old's 30d) and pushes saved-touched (0d) out.
   *
   * Separate from the case above so the ordering and the predicate fail
   * independently — together they would pin three properties under one name.
   */
  it('unsubmittedSaved sample is ordered by createdAt, not updatedAt', async () => {
    await seed([
      { id: 'saved-touched', status: 'saved', updatedAt: daysAgo(0), createdAt: daysAgo(25) },
    ]);

    const { attention } = await getDashboardStats(USER_A);

    expect(ids(attention.samples.unsubmittedSaved)).toEqual(['saved-old', 'saved-touched']);
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
    expect(attention.counts.stale).toBe(1); // a-stale (a-saved is not applied/phone_screen)
    expect(attention.counts.unsubmittedSaved).toBe(1); // a-saved
    expect(attention.counts.missingJobDescription).toBe(1); // a-nodesc
    expect(attention.counts.interviewing).toBe(1); // a-interview
  });

  it('samples never carry another owner’s rows', async () => {
    const { attention } = await getDashboardStats(USER_A);

    const sampled = [
      ...attention.samples.interviewing,
      ...attention.samples.stale,
      ...attention.samples.missingJobDescription,
      ...attention.samples.unsubmittedSaved,
    ];
    expect(sampled.length).toBeGreaterThan(0);
    // Anchored: assert the owner, not merely the absence of a known-bad id.
    // `undefined` reads as "matches everything", so an id-shaped oracle that
    // silently matched nothing would certify a leak (WIC-1518).
    for (const row of sampled) {
      expect(row.id.startsWith('a-')).toBe(true);
    }
    expect(ids(attention.samples.stale)).toEqual(['a-stale']);
  });

  it('user B sees its own aggregates, not A’s', async () => {
    const { attention } = await getDashboardStats(USER_B);

    expect(attention.counts.stale).toBe(3); // 3 applied only (saved no longer counts)
    expect(attention.counts.unsubmittedSaved).toBe(3);
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
    expect(attention.counts.stale).toBe(4); // a-stale + 3 of B's applied rows
  });
});
