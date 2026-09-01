/**
 * WIC-1478. `dashboard.routes.test.ts` mocks `dashboard.service.js` wholesale,
 * so it pins the wire contract and nothing else — the attention aggregation
 * that this card exists to create was executed by no test at all. Inverting
 * `lt` to `gte` on both thresholds compiles (`gte` is already imported), would
 * genuinely ship, and passed the entire gate: build, lint, format:check,
 * api 32 files / 739 passed, web 19 files / 128 passed — every figure identical
 * to the clean baseline, while reporting the freshly-touched applications as
 * the ones needing follow-up. That is the exact inversion the card was filed
 * about, reintroduced one layer down.
 *
 * Two things have to be pinned, and they fail independently:
 *
 *   1. the predicates — the *direction* of each threshold comparison and the
 *      status set each count is taken over;
 *   2. the wiring — that the number reported as `counts.stale` is the one the
 *      stale predicate produced, and not a sibling's.
 *
 * Neither needs a database. The predicates are rendered to SQL with drizzle's
 * own dialect via the repo's existing `renderClause` (the `star-catalog-stub`
 * technique). The wiring is pinned by handing `getDashboardStats` a `db` that
 * returns a *distinct* count per predicate it is asked about, so swapping two
 * `countMatching` calls changes which number lands in which field.
 *
 * Deliberately NOT done here: evaluating the threshold against fixture rows.
 * `applyTenancyPredicate` treats `<` as opaque and keeps every row — probed at
 * this head, a stale row and a fresh row both survive `lt(updatedAt, t)` — so a
 * fixture-based "40 of 150 are stale" test would pass under the `gte` mutant
 * too. It would read as the strongest test in the file and assert nothing.
 *
 * Named `dashboard.attention-conditions` and not `dashboard.service` on
 * purpose. PR #188 (WIC-1574), filed off this PR's own review and stacked on
 * this branch, adds a `dashboard.service.test.ts` that drives the same code
 * against PGlite. The two are complementary rather than duplicate: that one
 * runs real SQL through a planner and so reaches the row-level defects this
 * file structurally cannot (a `LIMIT` applied to a `count(*)`, a dropped
 * tenancy term), while this one needs no new dependency and so can land in the
 * PR that owns the code. Sharing a filename would only have made them collide
 * add/add.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getTableName } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import {
  buildAttentionConditions,
  getDashboardStats,
  STALE_THRESHOLD_DAYS,
  SAVED_THRESHOLD_DAYS,
} from '../src/services/dashboard.service.js';
import { renderClause } from './helpers/tenancy.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

const daysBefore = (days: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

describe('buildAttentionConditions', () => {
  it('derives both thresholds by subtracting their declared day counts from now', () => {
    const { staleThreshold, savedThreshold } = buildAttentionConditions(NOW);

    expect(STALE_THRESHOLD_DAYS).toBe(7);
    expect(SAVED_THRESHOLD_DAYS).toBe(3);
    expect(staleThreshold.toISOString()).toBe(daysBefore(STALE_THRESHOLD_DAYS));
    expect(savedThreshold.toISOString()).toBe(daysBefore(SAVED_THRESHOLD_DAYS));
  });

  it('does not mutate the instant it is handed', () => {
    const now = new Date(NOW);
    buildAttentionConditions(now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });

  it('counts an application stale when updated_at is BEFORE the threshold, over the four non-terminal statuses', () => {
    const { staleCondition } = buildAttentionConditions(NOW);
    const { sql, params } = renderClause(staleCondition);

    // The direction is the whole defect: `>=` here reports the freshly-touched
    // rows as the ones needing follow-up, which is what the card was filed about.
    expect(sql).toContain('"applications"."updated_at" < ');
    expect(sql).not.toMatch(/"applications"\."updated_at" >/);
    expect(params).toEqual([
      'saved',
      'applied',
      'phone_screen',
      'interview',
      daysBefore(STALE_THRESHOLD_DAYS),
    ]);
  });

  it('excludes saved from the stale-ACTIVE count, and still compares before the threshold', () => {
    const { staleActiveCondition } = buildAttentionConditions(NOW);
    const { sql, params } = renderClause(staleActiveCondition);

    expect(sql).toContain('"applications"."updated_at" < ');
    expect(sql).not.toMatch(/"applications"\."updated_at" >/);
    expect(params).toEqual([
      'applied',
      'phone_screen',
      'interview',
      daysBefore(STALE_THRESHOLD_DAYS),
    ]);
    expect(params).not.toContain('saved');
  });

  it('counts a saved application not-yet-submitted when created_at is BEFORE the saved threshold', () => {
    const { staleSavedCondition } = buildAttentionConditions(NOW);
    const { sql, params } = renderClause(staleSavedCondition);

    // `created_at`, not `updated_at`: a saved row that was edited yesterday is
    // still one the user never submitted.
    expect(sql).toContain('"applications"."created_at" < ');
    expect(sql).not.toMatch(/"applications"\."created_at" >/);
    expect(sql).not.toContain('"applications"."updated_at"');
    expect(params).toEqual(['saved', daysBefore(SAVED_THRESHOLD_DAYS)]);
  });

  it('treats a null OR empty job description as missing, over the non-terminal statuses', () => {
    const { missingDescriptionCondition } = buildAttentionConditions(NOW);
    const { sql, params } = renderClause(missingDescriptionCondition);

    expect(sql).toContain('"applications"."job_description" is null');
    expect(sql).toContain(' or ');
    expect(params).toEqual(['saved', 'applied', 'phone_screen', 'interview', '']);
  });

  it('counts only the two interviewing statuses', () => {
    const { interviewingCondition } = buildAttentionConditions(NOW);
    const { params } = renderClause(interviewingCondition);

    expect(params).toEqual(['phone_screen', 'interview']);
  });
});

// ── Wiring: predicate → the field it is reported in ──────────────────────────

/**
 * Every param a predicate binds that is not a timestamp. Unique per attention
 * predicate, and stable across the millisecond drift between the `new Date()`
 * inside the service and the one this file pins — so it identifies *which*
 * predicate a query carries without depending on when it ran.
 */
const signatureOf = (params: unknown[]): string =>
  JSON.stringify(params.filter((p) => !(typeof p === 'string' && ISO_INSTANT.test(p))));

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** A distinct count per predicate, so a swapped wiring cannot report the right number. */
const COUNT_BY_SIGNATURE: Record<string, number> = {
  '["saved","applied","phone_screen","interview"]': 41, // staleCondition
  '["applied","phone_screen","interview"]': 23, // staleActiveCondition
  '["saved","applied","phone_screen","interview",""]': 17, // missingDescriptionCondition
  '["saved"]': 9, // staleSavedCondition
};

const STATUS_ROWS = [
  { status: 'saved', count: 12 },
  { status: 'applied', count: 60 },
  { status: 'phone_screen', count: 5 },
  { status: 'interview', count: 3 },
  { status: 'offer', count: 1 },
  { status: 'rejected', count: 6 },
];

/**
 * A `db` that answers each scalar count with a number keyed to the predicate it
 * was handed. It deliberately does not evaluate the predicate against rows —
 * see the file header for why that would be vacuous here.
 */
function signatureCountingDb(): unknown {
  const chain = () => {
    let table = '';
    let grouped = false;
    let limited = false;
    let params: unknown[] = [];

    const self: Record<string, unknown> = {
      from(t: unknown) {
        table = getTableName(t as Parameters<typeof getTableName>[0]);
        return self;
      },
      where(clause: unknown) {
        params = renderClause(clause).params;
        return self;
      },
      groupBy() {
        grouped = true;
        return self;
      },
      orderBy() {
        return self;
      },
      limit() {
        limited = true;
        return self;
      },
      innerJoin() {
        return self;
      },
      then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
        let rows: unknown[];
        if (table === 'status_history') {
          rows = [];
        } else if (grouped) {
          rows = STATUS_ROWS;
        } else if (limited) {
          rows = []; // the bounded sample lists; not what this block is about
        } else {
          rows = [{ count: COUNT_BY_SIGNATURE[signatureOf(params)] ?? 0 }];
        }
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return self;
  };

  return { select: () => chain() };
}

describe('getDashboardStats attention counts', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue(signatureCountingDb() as ReturnType<typeof getDb>);
  });

  it('reports each count under the predicate that produced it', async () => {
    const { attention } = await getDashboardStats();

    // Each number is unique to one predicate, so swapping any two of the four
    // `countMatching` calls moves a number into the wrong field and reds this.
    expect(attention.counts.stale).toBe(41);
    expect(attention.counts.staleActive).toBe(23);
    expect(attention.counts.missingJobDescription).toBe(17);
    expect(attention.counts.staleSaved).toBe(9);
  });

  it('derives the interviewing count from byStatus rather than a query of its own', async () => {
    const { stats, attention } = await getDashboardStats();

    // The service comments that these two "can never disagree". `interviewing`
    // is the one attention count with no `countMatching` call behind it, so if
    // it were ever re-queried it would pick up the fake's 0 instead.
    expect(attention.counts.interviewing).toBe(
      stats.byStatus.phone_screen + stats.byStatus.interview
    );
    expect(attention.counts.interviewing).toBe(8);
  });

  it('sends the thresholds it actually used down the wire', async () => {
    const { attention } = await getDashboardStats();

    // The ">7 days" copy on the card is rendered from these, so they must be
    // the same constants the SQL above was built from.
    expect(attention.staleThresholdDays).toBe(STALE_THRESHOLD_DAYS);
    expect(attention.savedThresholdDays).toBe(SAVED_THRESHOLD_DAYS);
  });
});
