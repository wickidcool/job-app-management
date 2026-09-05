import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { and, eq, inArray, type SQL } from 'drizzle-orm';

/**
 * WIC-1479. The product used to ship seven definitions of "stale" across
 * surfaces that link to each other — the card named three, and the review of
 * PR #222 plus the tree-wide scan at the bottom of this file found four more.
 * `packages/api/src/services/stale.ts` enumerates all seven.
 *
 * The attention card renders a count and links straight to the report, so a
 * user could be told "1 application needs follow-up (>7 days)", click through,
 * and be shown "No stale applications found". Only the report was specified
 * (UC-5 US-5.7, WIC-143); every other surface drifted because nothing ever
 * specified it.
 *
 * These tests pin the single definition, and — more importantly — pin that the
 * surfaces *derive* it from one place rather than each holding a copy that
 * happens to agree today. Four of the seven agreed on the threshold and
 * differed only on the status set, so a guard that pinned the number would have
 * passed on all of them.
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

/**
 * The caller both surfaces are measured for (WIC-2065).
 *
 * `getStaleReport` now takes `userId: string` and emits the owner term
 * unconditionally (ADR-010 AC-T0), so these tests supply a concrete owner
 * rather than relying on the owner-absent arm they used to take by default.
 * Passing the *same* owner to `getDashboardStats` is what keeps AC-N2b an
 * apples-to-apples comparison — and strengthens it, since the two surfaces must
 * now agree on the owner scoping as well as on the stale definition.
 */
const OWNER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

/**
 * The literal stale status pair, in either order, however it is spaced or
 * quoted — the signature of a second definition inlined back into a call site.
 *
 * One binding, returned fresh per call, because every copy of a source-scanning
 * regex is a copy that can rot on its own. The first revision of this file kept
 * four and they had already diverged from the code: none tolerated the trailing
 * comma prettier adds once the array reflows across lines, which is exactly how
 * `stale.ts` itself is formatted — so the guard would not have matched the very
 * declaration it exists to detect duplicates of. A `/g` regex is stateful under
 * `.test`, hence the factory rather than a shared constant.
 */
const inlineStalePair = () =>
  /\[\s*['"](applied|phone_screen)['"]\s*,\s*['"](applied|phone_screen)['"]\s*,?\s*\]/g;

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
    await getDashboardStats(OWNER);
    const dashboardClauses = captured.map(serialize);

    captured = [];
    await getStaleReport({}, OWNER);
    const reportClauses = captured.map(serialize);

    // The owner term is part of the shared shape now, not an optional extra:
    // both surfaces emit `and(<stale>, user_id = $n)`. Asserting the composed
    // predicate rather than `staleWhere()` alone is what keeps this test
    // sensitive after WIC-2065 — matching on the bare stale predicate would
    // silently stop finding either clause instead of comparing them.
    const expected = serialize(and(staleWhere(), eq(applications.userId, OWNER)));
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
    expect(normalise(dashboardStale!).params).toEqual(['applied', 'phone_screen', OWNER]);
  });

  it('both cutoffs land on the same day', async () => {
    const day = (params: unknown[]) =>
      params
        .filter((p): p is string => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(p))
        .map((p) => p.slice(0, 10));

    await getDashboardStats(OWNER);
    const dashboardDays = captured.flatMap((c) => day(serialize(c).params));

    captured = [];
    await getStaleReport({}, OWNER);
    const reportDays = captured.flatMap((c) => day(serialize(c).params));

    const expectedDay = staleCutoff().toISOString().slice(0, 10);
    expect(dashboardDays).toContain(expectedDay);
    expect(reportDays).toContain(expectedDay);
  });
});

/**
 * `/reports/stale?status=` — the one caller allowed to pass `statuses`.
 *
 * Found in review of PR #222: the filter was applied against the *full status
 * enum*, not `STALE_STATUSES`, so `?status=saved,applied,phone_screen,interview`
 * was honoured verbatim and served the exact drifted definition this card was
 * filed about — from the surface the card calls conformant. The parameter is
 * documented as narrowing-only, so assert on the query the service actually
 * issues rather than on the rows a fixture happens to hold.
 */
describe('?status= can narrow the definition but never widen it', () => {
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

  /** The status names bound into the report's WHERE clause. */
  async function statusesQueried(status?: string): Promise<string[]> {
    captured = [];
    await getStaleReport(status === undefined ? {} : { status }, OWNER);
    return (
      captured
        .flatMap((c) => serialize(c).params)
        // Drop the cutoff timestamp and the owner binding (WIC-2065) — everything
        // left is a status name. Excluding the owner by *value* rather than by
        // "is this a known status" is deliberate: a filter that kept only
        // recognised statuses would discard exactly the widening this suite
        // exists to catch.
        .filter(
          (p): p is string => typeof p === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(p) && p !== OWNER
        )
    );
  }

  it('queries the full definition when no filter is given', async () => {
    expect(await statusesQueried()).toEqual(['applied', 'phone_screen']);
  });

  it('narrows to a single member', async () => {
    expect(await statusesQueried('applied')).toEqual(['applied']);
  });

  it.each(['saved', 'interview', 'offer', 'rejected', 'withdrawn'])(
    'drops %s rather than widening the definition to include it',
    async (status) => {
      expect(await statusesQueried(status)).not.toContain(status);
    }
  );

  it('drops the widening members of a mixed filter and keeps the rest', async () => {
    // The exact string that reproduced the defect. Before the fix this bound all
    // four names and the endpoint served the pre-WIC-1479 definition.
    expect(await statusesQueried('saved,applied,phone_screen,interview')).toEqual([
      'applied',
      'phone_screen',
    ]);
  });

  it('is unaffected by whitespace and still narrows through it', async () => {
    expect(await statusesQueried(' interview , applied ')).toEqual(['applied']);
  });

  it('returns an empty report, not a 500, when the filter leaves nothing', async () => {
    // The trap flagged in review: narrowing the filter means a caller can hand
    // `staleWhere` an empty set, and drizzle's `inArray` throws on one
    // ("inArray requires at least one value"). An empty report is the correct
    // answer to "which saved applications are stale"; a 500 is not.
    await expect(getStaleReport({ status: 'saved' }, OWNER)).resolves.toMatchObject({
      applications: [],
      summary: { total: 0, averageDaysStale: 0 },
    });
  });

  it('the empty set compiles to a predicate matching no row', () => {
    const { sql } = serialize(staleWhere({ statuses: [] }));
    expect(sql).toContain('1 = 0');
    // And it is genuinely restrictive rather than an absent WHERE, which would
    // return every row in the table — the failure mode returning `undefined`
    // would have given.
    expect(sql).toContain(' where ');
  });

  it('inArray still throws on an empty list, so the early return is load-bearing', () => {
    // Negative control on the guard itself. A guard whose hazard has quietly
    // gone away is indistinguishable from one that is doing work; if drizzle
    // ever tolerates an empty `inArray`, this fails and says so.
    expect(() => inArray(applications.status, [])).toThrow();
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
    expect([...code.matchAll(inlineStalePair())]).toHaveLength(0);
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
    expect([...offending.matchAll(inlineStalePair())]).toHaveLength(1);
    expect([...offending.matchAll(UPPER_BOUND_ON_UPDATED_AT)]).toHaveLength(1);

    // The form that was silently invisible until the tree-wide scan's positive
    // control tripped on it: once prettier reflows the array past the print
    // width it gains a trailing comma, and `stale.ts` is formatted that way
    // today. A guard blind to how the codebase is actually formatted is a guard
    // that only ever catches the tidy half of the defect.
    const reflowed = stripComments(`
      const staleStatuses = [
        'applied',
        'phone_screen',
      ];
    `);
    expect([...reflowed.matchAll(inlineStalePair())]).toHaveLength(1);
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

  it('stale.ts declares the definition exactly once', () => {
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

/**
 * The scan above, widened from two named services to the whole package.
 *
 * The previous revision of this file called its last test "stale.ts is the only
 * file that names the definition" while reading only `stale.ts` — it asserted
 * nothing about any other file, and the review of PR #222 caught the title
 * claiming a reach the body did not have. Two more definitions were live at the
 * time, in `packages/web`; the web half of this scan is in
 * `packages/web/src/constants/stale.drift.test.ts`.
 *
 * A per-file allowlist would rot the moment someone adds a service, so this
 * enumerates the tree instead and pins the enumeration itself: an empty or
 * truncated walk is a vacuous pass, and a green run would look identical.
 */
describe('no file in packages/api holds a second definition (AC-N2a, tree-wide)', () => {
  const SRC = new URL('../src/', import.meta.url);

  /** Every `.ts` under `packages/api/src`, relative to it, sorted. */
  function walk(dir = ''): string[] {
    return readdirSync(new URL(dir, SRC), { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(`${dir}${entry.name}/`)
          : entry.name.endsWith('.ts')
            ? [`${dir}${entry.name}`]
            : []
      )
      .sort();
  }

  const FILES = walk();
  const DEFINITION = 'services/stale.ts';

  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  const sourceOf = (relative: string) =>
    stripComments(readFileSync(new URL(relative, SRC), 'utf-8'));

  it('walks a tree that actually contains the code under guard', () => {
    // Without this the walk could return `[]` — from a renamed directory, a
    // changed extension, a `readdirSync` that silently yields nothing — and
    // every scan below would pass by scanning nothing. Pin the scope, not just
    // the verdict.
    expect(FILES).toContain(DEFINITION);
    expect(FILES).toContain('services/dashboard.service.ts');
    expect(FILES).toContain('services/reports.service.ts');
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('finds the definition only in stale.ts', () => {
    const offenders = FILES.filter((f) => f !== DEFINITION && inlineStalePair().test(sourceOf(f)));
    expect(offenders, `inline stale status pair outside ${DEFINITION}`).toEqual([]);
    // Positive control: the definition itself must still match, or the regex
    // has stopped matching anything and the scan above is vacuous. This is the
    // assertion that caught the missing trailing comma.
    expect(inlineStalePair().test(sourceOf(DEFINITION))).toBe(true);
  });

  it('finds an upper-bound predicate on updatedAt only in stale.ts', () => {
    const rebuilt = /\b(lt|lte)\s*\(\s*applications\.updatedAt\b/;
    const offenders = FILES.filter((f) => f !== DEFINITION && rebuilt.test(sourceOf(f)));
    expect(offenders, `rebuilt stale predicate outside ${DEFINITION}`).toEqual([]);
    expect(rebuilt.test(sourceOf(DEFINITION))).toBe(true);
  });

  it('the tree-wide scan fails on a planted second definition', () => {
    // Negative control. `offenders` is asserted empty, and an empty result is
    // exactly what a broken scan produces — so plant the defect and require the
    // predicate that drives the filter to catch it.
    const planted = stripComments(`
      // a plausible-looking helper someone adds to a new service
      const statuses = ['applied', 'phone_screen'];
      const cutoff = lt(applications.updatedAt, new Date());
    `);
    expect(inlineStalePair().test(planted)).toBe(true);
    expect(/\b(lt|lte)\s*\(\s*applications\.updatedAt\b/.test(planted)).toBe(true);

    // ...and does not fire on the shapes that legitimately exist in the tree:
    // the closed-loop report's lower bound, and the full status enum.
    expect(
      /\b(lt|lte)\s*\(\s*applications\.updatedAt\b/.test('gte(applications.updatedAt, since)')
    ).toBe(false);
    expect(inlineStalePair().test("['saved', 'applied', 'phone_screen', 'interview']")).toBe(false);
  });
});
