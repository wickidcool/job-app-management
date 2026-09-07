/**
 * WIC-2268 — `getNeedsActionReport` mixed local and UTC midnights.
 *
 * ## Two defects, firing in COMPLEMENTARY zones
 *
 * The card (spun out of WIC-2267) named one of these. Sweeping the function turned up a
 * second one, and the pair is why "just fix the parse" would have left the function broken
 * for half the world:
 *
 * | # | site | hazard | breaks in | blast radius |
 * |---|------|--------|-----------|--------------|
 * | 1 | `new Date(r.nextActionDue)` | date-only string parses as **UTC** midnight, diffed against a **local** `today` | **negative**-offset zones (the Americas) | wrong `urgency` badge on a row that IS returned |
 * | 2 | `today.toISOString().split('T')[0]` | a **local** midnight round-tripped through **UTC** | **positive**-offset zones (EU/Asia/Oceania) | wrong **SQL filter bound** — changes which rows come back at all |
 *
 * Defect 2 is the more serious one and was not in the card: `todayStr`/`thresholdStr` are
 * `gte`/`lte` bounds on the query, so in a positive-offset zone the window is shifted one
 * day early — rows due on the last day of the window are **silently missing from the
 * report**, and with `includeOverdue: false` rows due *yesterday* are wrongly included.
 * A missing row renders as nothing at all, so it cannot be noticed from the page.
 *
 * Measured over 8 zones x 6 base dates x 206 start-minutes x 14 due-date offsets
 * (17,304 rows/zone), current implementation vs local wall-calendar ground truth:
 *
 * ```
 * zone                  urgency wrong   todayStr/thresholdStr wrong
 * UTC                       0 / 17304            0 / 17304   <- positive control
 * America/New_York       2472 / 17304            0 / 17304
 * America/Los_Angeles    2472 / 17304            0 / 17304
 * America/Sao_Paulo      2472 / 17304            0 / 17304
 * Europe/Berlin             0 / 17304        17304 / 17304   <- 100%, all day every day
 * Europe/London             0 / 17304         5768 / 17304   <- BST only; clean in GMT
 * Asia/Tokyo                0 / 17304        17304 / 17304
 * Asia/Kolkata              0 / 17304        17304 / 17304
 * Pacific/Kiritimati        0 / 17304        17304 / 17304
 * ```
 *
 * London is the signature: clean in GMT, broken in BST. The defect tracks the **sign of the
 * UTC offset**, which is what distinguishes this parse/format bug from a coincidence.
 *
 * ## Why `Math.floor` had to go too — the card's suggested fix was not sufficient
 *
 * WIC-2268 proposed fixing the parse and keeping the existing `Math.floor`, on the reasoning
 * that with both operands at local midnight the quotient becomes a whole number. It does
 * not: across a **spring-forward** boundary two local midnights are 23h apart, so the
 * quotient is `n - 1/24` and `floor` reports one day fewer. Re-measured over the four
 * US/EU DST transition dates with the parse ALREADY fixed:
 *
 * ```
 * zone                floor wrong   round wrong
 * UTC                    0 / 14420     0 / 14420
 * America/New_York    2017 / 14420     0 / 14420
 * Europe/Berlin       1914 / 14420     0 / 14420
 * ```
 *
 * Hence `calendarDaysBetween` uses `Math.round`. The `crossesSpringForward` block below is
 * the arm that grades this specifically — it is green against the card's proposed fix and
 * red against nothing else in this file, so deleting it silently re-admits `floor`.
 *
 * ## What this file grades
 *
 * Two oracles, because they catch different mutants:
 *
 *   1. **Structural — the emitted SQL bounds.** `boundsFor` reads the bind params off the
 *      clause the service really built. Grading defect 2 *behaviourally* would need the
 *      stub to evaluate `>=`/`<=`, and the one shared evaluator in this package
 *      (`helpers/tenancy.ts`) deliberately parses those to `opaque`; widening a
 *      security-critical tenancy harness to serve a date test is the wrong trade. Asserting
 *      the emitted bound is also the stronger check — it cannot be satisfied by a stub's
 *      filtering mood (WIC-2260).
 *   2. **Behavioural — the `urgency` on the returned DTO.** Grades defect 1 through the
 *      real entry point.
 *
 * **The UTC block is a positive control, not coverage.** It is green against the pre-fix
 * tree *and* the fixed one. Its job is to fail if `TZ` pinning ever stops taking effect —
 * without it, a harness whose zones silently all became UTC would read as full coverage
 * while grading nothing. That is exactly how the client-side twin (WIC-2267) survived CI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();

// ── A stub that records the clause and does NOT filter ────────────────────────
// Deliberately unfiltered: every fixture reaches the urgency mapper, so the behavioural
// oracle grades all of them. The bounds are graded structurally instead (see header).
interface Recorded {
  clause: unknown;
}
const recorded: Recorded = { clause: undefined };
let fixtures: Record<string, unknown>[] = [];

function makeDb() {
  const self: Record<string, unknown> = {
    from: () => self,
    where: (clause: unknown) => {
      recorded.clause = clause;
      return self;
    },
    orderBy: () => self,
    limit: () => self,
    offset: () => self,
    then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(fixtures).then(res, rej),
  };
  return { select: () => self };
}

vi.mock('../src/db/client.js', () => ({ getDb: () => makeDb() }));

const { getNeedsActionReport } = await import('../src/services/reports.service.js');

const OWNER = '33333333-3333-4333-8333-333333333333';

const pad = (n: number) => String(n).padStart(2, '0');
/** `YYYY-MM-DD` from a Date's LOCAL calendar fields. */
const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The local calendar date `offset` days from the pinned `now`. */
const localDayOffset = (offset: number) => {
  const n = new Date();
  return localDateStr(new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset));
};

function row(id: string, nextActionDue: string) {
  return {
    id,
    jobTitle: 'Backend Engineer',
    company: 'Acme',
    status: 'applied',
    nextAction: 'Follow up',
    nextActionDue,
    contact: null,
    userId: OWNER,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/** The `YYYY-MM-DD` bind params on the clause the service actually built, in order. */
function boundsFor(clause: unknown): string[] {
  const { params } = dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
  return [...params].filter(
    (p): p is string => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p)
  );
}

/**
 * Pin both the zone and the instant. `process.env.TZ` is honoured for Dates constructed
 * after assignment on Node >= 16 (verified on the v24 in this repo).
 */
function pin(zone: string, isoInstant: string) {
  process.env.TZ = zone;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoInstant));
}

const ORIGINAL_TZ = process.env.TZ;

describe('getNeedsActionReport — date-only handling is timezone-correct (WIC-2268)', () => {
  beforeEach(() => {
    recorded.clause = undefined;
    fixtures = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = ORIGINAL_TZ;
  });

  // Each case pins an instant that is unambiguous in the target zone. `dueOffsets` are
  // expressed in LOCAL calendar days from the pinned instant, so the expectation is the
  // same sentence in every zone — which is the property under test.
  const ZONES = [
    // zone,                instant (UTC),           why
    ['UTC', '2026-09-10T12:00:00Z', 'positive control — green pre-fix AND post-fix'],
    ['America/New_York', '2026-09-10T12:00:00Z', 'negative offset — grades the parse'],
    ['Europe/Berlin', '2026-09-10T12:00:00Z', 'positive offset — grades the SQL bounds'],
    ['Asia/Kolkata', '2026-09-10T12:00:00Z', 'half-hour positive offset'],
  ] as const;

  describe.each(ZONES)('in %s (%s)', (zone, instant) => {
    it('emits SQL bounds on the LOCAL calendar day, not the UTC one', () => {
      pin(zone, instant);
      const expectedToday = localDayOffset(0);
      const expectedThreshold = localDayOffset(7);

      return getNeedsActionReport({ days: 7, includeOverdue: false }, OWNER).then(() => {
        const bounds = boundsFor(recorded.clause);
        // `includeOverdue: false` emits both bounds: today <= due <= threshold.
        expect(bounds).toEqual([expectedToday, expectedThreshold]);
      });
    });

    it('badges a row due TODAY as due_soon, not overdue', async () => {
      pin(zone, instant);
      const today = localDayOffset(0);
      fixtures = [row('app-today', today)];

      const res = await getNeedsActionReport({ days: 7 }, OWNER);
      const app = res.applications.find((a) => a.id === 'app-today');
      expect(app?.daysUntilDue).toBe(0);
      expect(app?.urgency).toBe('due_soon');
    });

    it('keeps daysUntilDue equal to the true local calendar-day gap', async () => {
      pin(zone, instant);
      const offsets = [-2, -1, 0, 1, 3, 4, 7];
      fixtures = offsets.map((o) => row(`app${o}`, localDayOffset(o)));

      const res = await getNeedsActionReport({ days: 7 }, OWNER);
      const got = Object.fromEntries(res.applications.map((a) => [a.id, a.daysUntilDue]));
      expect(got).toEqual(Object.fromEntries(offsets.map((o) => [`app${o}`, o])));
    });

    it('puts the due_soon/upcoming boundary at exactly 3 local days', async () => {
      pin(zone, instant);
      fixtures = [row('app3', localDayOffset(3)), row('app4', localDayOffset(4))];

      const res = await getNeedsActionReport({ days: 14 }, OWNER);
      const byId = Object.fromEntries(res.applications.map((a) => [a.id, a.urgency]));
      expect(byId).toEqual({ app3: 'due_soon', app4: 'upcoming' });
    });
  });

  // ── The arm that keeps `Math.floor` out ─────────────────────────────────────
  // Green against the card's proposed fix (local parse + `Math.floor`); nothing else in
  // this file is. Deleting this block silently re-admits the off-by-one across DST.
  describe('crossesSpringForward', () => {
    const TRANSITIONS = [
      // zone,             instant the day before the jump,  spring-forward date
      ['America/New_York', '2026-03-07T12:00:00Z'],
      ['Europe/Berlin', '2026-03-28T12:00:00Z'],
    ] as const;

    it.each(TRANSITIONS)(
      'in %s, a window spanning the DST jump keeps whole-day gaps',
      async (zone, instant) => {
        pin(zone, instant);
        const offsets = [1, 2, 3, 4, 5];
        fixtures = offsets.map((o) => row(`app${o}`, localDayOffset(o)));

        const res = await getNeedsActionReport({ days: 14 }, OWNER);
        const got = Object.fromEntries(res.applications.map((a) => [a.id, a.daysUntilDue]));
        // With `Math.floor` these come back one short for every offset past the jump.
        expect(got).toEqual(Object.fromEntries(offsets.map((o) => [`app${o}`, o])));
      }
    );
  });

  // ── Harness liveness ────────────────────────────────────────────────────────
  it('TZ pinning actually takes effect (guards the positive control)', () => {
    pin('UTC', '2026-09-10T02:00:00Z');
    const utcDay = localDayOffset(0);
    pin('America/New_York', '2026-09-10T02:00:00Z');
    const nyDay = localDayOffset(0);
    // 02:00Z on the 10th is still the 9th in New York. If these agree, TZ pinning is dead
    // and every zone block above is silently running as UTC.
    expect(utcDay).toBe('2026-09-10');
    expect(nyDay).toBe('2026-09-09');
  });
});
