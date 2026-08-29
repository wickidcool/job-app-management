import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * WIC-1479. The product used to ship three definitions of "stale" on surfaces
 * that link to each other:
 *
 *   - the dashboard attention card: every non-terminal status, >7 days;
 *   - the dashboard quick-wins list: applied/phone_screen/interview, >7 days;
 *   - `/reports/stale`: applied/phone_screen, >=14 days.
 *
 * The card renders a count and links straight to the report, so a user could be
 * told "1 application needs follow-up (>7 days)", click through, and be shown
 * "No stale applications found". Only the report was specified (UC-5 US-5.7,
 * WIC-143); the dashboard drifted because nothing ever specified it.
 *
 * These tests pin the single definition, and — more importantly — pin that both
 * surfaces *derive* it from one place rather than each holding a copy that
 * happens to agree today.
 */

const dbSpy = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../src/db/client.js', () => dbSpy);

import {
  STALE_STATUSES,
  DEFAULT_STALE_THRESHOLD_DAYS,
  resolveStaleThresholdDays,
  staleCutoff,
  staleWhere,
  isStale,
} from '../src/services/stale.js';
import { applications } from '../src/db/schema.js';
import { getDashboardStats } from '../src/services/dashboard.service.js';
import { getStaleReport } from '../src/services/reports.service.js';

/** Serializes a drizzle condition to SQL text + bound params, with no connection. */
function serialize(condition: SQL | undefined) {
  const { sql, params } = new QueryBuilder().select().from(applications).where(condition).toSQL();
  return { sql: sql.slice(sql.indexOf(' where ')), params };
}

describe('the single definition of stale (WIC-1479 AC-N2a)', () => {
  it('is applied + phone_screen only', () => {
    expect([...STALE_STATUSES]).toEqual(['applied', 'phone_screen']);
  });

  it('defaults to 14 days, the threshold UC-5 US-5.7 specifies', () => {
    expect(DEFAULT_STALE_THRESHOLD_DAYS).toBe(14);
  });

  it('excludes saved, interview and every terminal status', () => {
    // `saved` was never submitted, so there is nobody to follow up with;
    // `interview` is an active conversation, not a silence. Both were counted
    // as stale by the dashboard before this change.
    for (const status of ['saved', 'interview', 'offer', 'rejected', 'withdrawn'] as const) {
      expect(STALE_STATUSES).not.toContain(status);
    }
  });

  it('honours the report selector values and clamps nonsense', () => {
    for (const days of [7, 14, 21, 30]) {
      expect(resolveStaleThresholdDays(days)).toBe(days);
    }
    expect(resolveStaleThresholdDays(undefined)).toBe(14);
    expect(resolveStaleThresholdDays(0)).toBe(1);
    expect(resolveStaleThresholdDays(-5)).toBe(1);
    expect(resolveStaleThresholdDays(10_000)).toBe(365);
  });
});

describe('the SQL predicate matches its in-memory mirror', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it('emits an IN over the stale statuses and a strict < on updated_at', () => {
    // This pins the operator `isStale` assumes. If the SQL ever became `<=`,
    // or started comparing `created_at`, the two would disagree at the boundary
    // and only this assertion would notice.
    const { sql, params } = serialize(staleWhere({ now }));

    expect(sql).toContain('"applications"."status" in ($1, $2)');
    expect(sql).toContain('"applications"."updated_at" < $3');
    expect(params).toEqual(['applied', 'phone_screen', staleCutoff(14, now).toISOString()]);
  });

  it('agrees with isStale on both sides of the boundary', () => {
    const cutoff = staleCutoff(DEFAULT_STALE_THRESHOLD_DAYS, now);
    const justBefore = new Date(cutoff.getTime() - 1000);
    const justAfter = new Date(cutoff.getTime() + 1000);

    expect(isStale({ status: 'applied', updatedAt: justBefore }, { now })).toBe(true);
    expect(isStale({ status: 'applied', updatedAt: justAfter }, { now })).toBe(false);
    // Exactly on the cutoff is not stale, matching SQL's strict `<`.
    expect(isStale({ status: 'applied', updatedAt: cutoff }, { now })).toBe(false);
  });
});

/**
 * AC-N2c, reproduced verbatim from the ticket: one application in `interview`
 * status last updated 9 days ago, on an account holding three applications in
 * total, so no paging or truncation is involved.
 *
 * Before this change the dashboard said "1 application needs follow-up
 * (>7 days)" and the report it links to said "No stale applications found".
 */
describe('AC-N2c: the reported failure scenario', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const account = [
    { id: 'a', status: 'interview' as const, updatedAt: daysAgo(9) },
    { id: 'b', status: 'applied' as const, updatedAt: daysAgo(2) },
    { id: 'c', status: 'offer' as const, updatedAt: daysAgo(40) },
  ];

  it('counts zero stale applications, matching the report', () => {
    const stale = account.filter((app) => isStale(app, { now }));
    expect(stale).toHaveLength(0);
  });

  it('would have counted one under the old dashboard definition', () => {
    // The negative control. If this ever stops finding the row, the scenario
    // above has stopped being a reproduction of anything and the test below it
    // is asserting nothing.
    const OLD_STATUSES = ['saved', 'applied', 'phone_screen', 'interview'];
    const OLD_THRESHOLD_DAYS = 7;
    const oldCutoff = new Date(now.getTime() - OLD_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    const staleUnderOldRules = account.filter(
      (app) => OLD_STATUSES.includes(app.status) && app.updatedAt < oldCutoff
    );

    expect(staleUnderOldRules.map((a) => a.id)).toEqual(['a']);
  });

  it('still finds a genuinely stale application', () => {
    // Guards against the fix degrading into "nothing is ever stale".
    const withStale = [...account, { id: 'd', status: 'applied' as const, updatedAt: daysAgo(20) }];
    expect(withStale.filter((app) => isStale(app, { now })).map((a) => a.id)).toEqual(['d']);
  });
});

/**
 * AC-N2b, the load-bearing one: the count the dashboard shows must equal the
 * number of rows the report it links to renders under default parameters.
 *
 * Rather than assert two numbers agree on one fixture, this drives both real
 * services against a recording fake and compares the WHERE clause each actually
 * sends to Postgres. Equal SQL means equal counts on *every* dataset, which is
 * what "agree by construction" has to mean.
 */
describe('AC-N2b: dashboard and report issue the same query', () => {
  let captured: SQL[];

  function recordingDb() {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    Object.assign(chain, {
      select: passthrough,
      from: passthrough,
      where: (condition: SQL) => {
        captured.push(condition);
        return chain;
      },
      groupBy: passthrough,
      orderBy: passthrough,
      innerJoin: passthrough,
      limit: passthrough,
      offset: passthrough,
      then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    });
    return chain;
  }

  beforeEach(() => {
    captured = [];
    dbSpy.getDb.mockImplementation(() => recordingDb());
  });

  it('the dashboard stale count and the default stale report serialize identically', async () => {
    await getDashboardStats();
    const dashboardClauses = captured.map(serialize);

    captured = [];
    await getStaleReport();
    const reportClauses = captured.map(serialize);

    const expected = serialize(staleWhere());
    const normalise = (c: { sql: string; params: unknown[] }) => ({
      sql: c.sql,
      // The two services build their cutoff from `new Date()` microseconds
      // apart, so compare the status list and drop the timestamp param.
      params: c.params.filter((p) => typeof p === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(p)),
    });

    const dashboardStale = dashboardClauses.find(
      (c) => normalise(c).sql === normalise(expected).sql
    );
    const reportStale = reportClauses.find((c) => normalise(c).sql === normalise(expected).sql);

    expect(
      dashboardStale,
      'dashboard issues no query matching the shared stale predicate'
    ).toBeDefined();
    expect(
      reportStale,
      'stale report issues no query matching the shared stale predicate'
    ).toBeDefined();
    expect(normalise(dashboardStale!)).toEqual(normalise(reportStale!));
    expect(normalise(dashboardStale!).params).toEqual(['applied', 'phone_screen']);
  });

  it('both cutoffs land on the same day', async () => {
    const day = (params: unknown[]) =>
      params
        .filter((p): p is string => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(p))
        .map((p) => p.slice(0, 10));

    await getDashboardStats();
    const dashboardDays = captured.flatMap((c) => day(serialize(c).params));

    captured = [];
    await getStaleReport();
    const reportDays = captured.flatMap((c) => day(serialize(c).params));

    const expectedDay = staleCutoff().toISOString().slice(0, 10);
    expect(dashboardDays).toContain(expectedDay);
    expect(reportDays).toContain(expectedDay);
  });
});

/**
 * The drift guard. Both services now call `staleWhere()`, but nothing stops a
 * future edit from inlining `['applied','phone_screen']` or a day literal back
 * into either file — which is exactly how this defect was introduced the first
 * time. A guard that only checked "does it import stale.js" would keep passing
 * while a second, unused-but-authoritative-looking copy grew beside it.
 */
describe('neither service re-inlines the definition', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8');

  const SERVICES = [
    ['dashboard.service.ts', '../src/services/dashboard.service.ts'],
    ['reports.service.ts', '../src/services/reports.service.ts'],
  ] as const;

  /** Strips comments so prose about the old definition cannot trip the guard. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  it.each(SERVICES)('%s builds its stale query from staleWhere()', (_name, path) => {
    const code = stripComments(read(path));
    expect([...code.matchAll(/staleWhere\(/g)]).not.toHaveLength(0);
  });

  it.each(SERVICES)('%s contains no inline stale status list', (_name, path) => {
    const code = stripComments(read(path));
    // The literal pair, in either order, however it is spaced or quoted.
    const inlinePair =
      /\[\s*['"](applied|phone_screen)['"]\s*,\s*['"](applied|phone_screen)['"]\s*\]/g;
    expect([...code.matchAll(inlinePair)]).toHaveLength(0);
  });

  /**
   * The precise signature of a rebuilt stale predicate is an *upper-bound*
   * comparison on `updatedAt` — "last touched before X". Only `stale.ts` may
   * write one.
   *
   * A file-wide scan for bare 7/14/21/30 was tried first and is not sound: both
   * services legitimately hold other durations (`appliedThisWeek`'s 7,
   * `getNeedsActionReport`'s own default, the closed-loop report's `'30d'`),
   * so it flagged three lines that have nothing to do with staleness. Note also
   * that `gte(applications.updatedAt, since)` in `getClosedLoopReport` is the
   * opposite direction — recent *activity*, not silence — and must not trip it.
   */
  const UPPER_BOUND_ON_UPDATED_AT = /\b(lt|lte)\s*\(\s*applications\.updatedAt\b/g;

  it.each(SERVICES)('%s does not rebuild the stale predicate', (_name, path) => {
    const code = stripComments(read(path));
    const hits = [...code.matchAll(UPPER_BOUND_ON_UPDATED_AT)].map((m) => m[0]);
    expect(hits, `rebuilt stale predicate: ${JSON.stringify(hits)}`).toHaveLength(0);
  });

  /**
   * With the predicate itself locked down, the one remaining way to re-drift is
   * to keep calling `staleWhere` but hand it a hardcoded window —
   * `staleWhere({ days: 7 })`. Callers must pass a variable resolved through
   * `resolveStaleThresholdDays`, or nothing at all.
   *
   * Scanning stale-ish *lines* for any digit was tried before this and is not
   * sound either: it flags `staleApps.length > 0`.
   */
  const LITERAL_DAYS_ARGUMENT = /days\s*:\s*\d/g;

  it.each(SERVICES)('%s passes no hardcoded window to staleWhere', (_name, path) => {
    const code = stripComments(read(path));
    const hits = [...code.matchAll(LITERAL_DAYS_ARGUMENT)].map((m) => m[0]);
    expect(hits, `hardcoded stale window: ${JSON.stringify(hits)}`).toHaveLength(0);
  });

  it('both guards fail on source that does inline the definition', () => {
    // Negative control. Without this, a typo in either regex is permanent green
    // — the guard would stop guarding and nothing would say so.
    const offending = stripComments(`
      const staleStatuses = ['applied', 'phone_screen'];
      const staleDays = params.days ?? 14;
      const cond = lt(applications.updatedAt, staleThreshold);
    `);
    const inlinePair =
      /\[\s*['"](applied|phone_screen)['"]\s*,\s*['"](applied|phone_screen)['"]\s*\]/g;

    expect([...offending.matchAll(inlinePair)]).toHaveLength(1);
    expect([...offending.matchAll(UPPER_BOUND_ON_UPDATED_AT)]).toHaveLength(1);
    expect([...'staleWhere({ days: 7 })'.matchAll(LITERAL_DAYS_ARGUMENT)]).toHaveLength(1);
    // ...and passes the shape the services actually use.
    expect([...'staleWhere({ days: staleDays })'.matchAll(LITERAL_DAYS_ARGUMENT)]).toHaveLength(0);
  });

  it('the predicate guard ignores lower-bound comparisons on updatedAt', () => {
    // `getClosedLoopReport` legitimately asks for rows updated *since* a date.
    // If the guard flagged that, the honest fix would be to weaken it, and a
    // weakened guard is how this class of defect returns.
    const legitimate = 'conditions.push(gte(applications.updatedAt, since));';
    expect([...legitimate.matchAll(UPPER_BOUND_ON_UPDATED_AT)]).toHaveLength(0);
  });

  it('stale.ts is the only file that names the definition', () => {
    const definition = read('../src/services/stale.ts');

    // Matched structurally, not as literal text: prettier reflows the array
    // across lines once it grows past the print width, and a guard that breaks
    // on reformatting is a guard someone weakens rather than fixes.
    const declarations = [...definition.matchAll(/^export const STALE_STATUSES = (\[[^\]]*\])/gm)];
    expect(declarations).toHaveLength(1);
    expect([...declarations[0][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([
      'applied',
      'phone_screen',
    ]);
    expect(definition).toContain('DEFAULT_STALE_THRESHOLD_DAYS = 14');
  });
});
