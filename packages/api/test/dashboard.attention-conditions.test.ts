/**
 * WIC-1478, retargeted onto WIC-1479's single definition of "stale".
 *
 * `dashboard.routes.test.ts` mocks `dashboard.service.js` wholesale, so it pins
 * the wire contract and nothing else — the attention aggregation that WIC-1478
 * exists to create was executed by no test at all. Inverting the threshold
 * comparisons compiles, would genuinely ship, and passed the entire gate while
 * reporting the freshly-touched applications as the ones needing follow-up:
 * the exact inversion the card was filed about, reintroduced one layer down.
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
 * What WIC-1479 changes here, and why the assertions had to move rather than
 * be dropped: `staleCondition` is no longer built in this module at all — it is
 * `staleWhere()`'s, whole. So the assertion worth making is no longer "the
 * dashboard's own stale predicate is spelled correctly" but **"the dashboard
 * adds nothing to the shared one"**, which is AC-N2b stated as a test. A local
 * `and(...)` wrapping `staleWhere()` would restore the drift the card deletes
 * and is invisible to `stale.definition.test.ts`, which grades `stale.ts`.
 * `staleActive` is gone with it — one definition means one count — and
 * `staleSaved` is now `unsubmittedSaved`, keyed off `createdAt`.
 *
 * Deliberately NOT done here: evaluating the threshold against fixture rows.
 * `applyTenancyPredicate` treats `<` as opaque and keeps every row — probed at
 * this head, a stale row and a fresh row both survive `lt(updatedAt, t)` — so a
 * fixture-based "40 of 150 are stale" test would pass under an inverted
 * comparison too. It would read as the strongest test in the file and assert
 * nothing.
 *
 * Named `dashboard.attention-conditions` and not `dashboard.service` on
 * purpose. PR #188 (WIC-1574), stacked on the same base, adds a
 * `dashboard.service.test.ts` that drives this code against PGlite. The two are
 * complementary: that one runs real SQL through a planner and so reaches the
 * row-level defects this file structurally cannot (a `LIMIT` applied to a
 * `count(*)`, a dropped tenancy term), while this one needs no new dependency.
 * Sharing a filename would only have made them collide add/add.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));

import { getTableName } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import {
  buildAttentionConditions,
  getDashboardStats,
  UNSUBMITTED_THRESHOLD_DAYS,
} from '../src/services/dashboard.service.js';
import { DEFAULT_STALE_THRESHOLD_DAYS, STALE_STATUSES, staleWhere } from '../src/services/stale.js';
import { renderClause } from './helpers/tenancy.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

const daysBefore = (days: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

describe('buildAttentionConditions', () => {
  it('takes the stale predicate from stale.ts whole, adding nothing of its own', () => {
    const { staleCondition } = buildAttentionConditions(NOW);

    // WIC-1479 AC-N2b, as a test rather than a comment. Byte-identical SQL and
    // params to the shared definition is the only assertion that catches a
    // local `and(...)` wrapped around it — an extra status filter or a second
    // day count here would leave `stale.definition.test.ts` completely green,
    // because that file grades `stale.ts` and this drift is not in `stale.ts`.
    expect(renderClause(staleCondition)).toEqual(renderClause(staleWhere({ now: NOW })));
  });

  it('counts an application stale when updated_at is BEFORE the shared threshold, over the shared status set', () => {
    const { staleCondition } = buildAttentionConditions(NOW);
    const { sql, params } = renderClause(staleCondition);

    // Spelled out rather than derived, so this fails if the shared definition
    // is changed without anyone deciding the dashboard should change with it.
    // The direction is the whole of WIC-1478: `>=` here reports the
    // freshly-touched rows as the ones needing follow-up.
    expect(sql).toContain('"applications"."updated_at" < ');
    expect(sql).not.toMatch(/"applications"\."updated_at" >/);
    expect(DEFAULT_STALE_THRESHOLD_DAYS).toBe(14);
    expect([...STALE_STATUSES]).toEqual(['applied', 'phone_screen']);
    expect(params).toEqual(['applied', 'phone_screen', daysBefore(DEFAULT_STALE_THRESHOLD_DAYS)]);
  });

  it('derives the unsubmitted threshold by subtracting its declared day count from now', () => {
    const { unsubmittedThreshold } = buildAttentionConditions(NOW);

    expect(UNSUBMITTED_THRESHOLD_DAYS).toBe(3);
    expect(unsubmittedThreshold.toISOString()).toBe(daysBefore(UNSUBMITTED_THRESHOLD_DAYS));
  });

  it('does not mutate the instant it is handed', () => {
    const now = new Date(NOW);
    buildAttentionConditions(now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });

  it('counts a saved application not-yet-submitted when created_at is BEFORE the unsubmitted threshold', () => {
    const { unsubmittedSavedCondition } = buildAttentionConditions(NOW);
    const { sql, params } = renderClause(unsubmittedSavedCondition);

    // `created_at`, not `updated_at`: a saved row that was edited yesterday is
    // still one the user never submitted. This is why it is not staleness and
    // no longer carries the word (WIC-1479 AC-N2a).
    expect(sql).toContain('"applications"."created_at" < ');
    expect(sql).not.toMatch(/"applications"\."created_at" >/);
    expect(sql).not.toContain('"applications"."updated_at"');
    expect(params).toEqual(['saved', daysBefore(UNSUBMITTED_THRESHOLD_DAYS)]);
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

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/**
 * Every param a predicate binds that is not a timestamp. Unique per attention
 * predicate, and stable across the millisecond drift between the `new Date()`
 * inside the service and the one this file pins — so it identifies *which*
 * predicate a query carries without depending on when it ran.
 */
const signatureOf = (params: unknown[]): string =>
  JSON.stringify(params.filter((p) => !(typeof p === 'string' && ISO_INSTANT.test(p))));

/** A distinct count per predicate, so a swapped wiring cannot report the right number. */
const COUNT_BY_SIGNATURE: Record<string, number> = {
  '["applied","phone_screen"]': 41, // staleCondition, i.e. staleWhere()
  '["saved","applied","phone_screen","interview",""]': 17, // missingDescriptionCondition
  '["saved"]': 9, // unsubmittedSavedCondition
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

    // Each number is unique to one predicate, so swapping any two of the three
    // `countMatching` calls moves a number into the wrong field and reds this.
    expect(attention.counts.stale).toBe(41);
    expect(attention.counts.missingJobDescription).toBe(17);
    expect(attention.counts.unsubmittedSaved).toBe(9);
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

    // The "> N days" copy on the card is rendered from these, so they must be
    // the same constants the SQL above was built from — and the stale one has
    // to be the shared definition's, not a local restatement of it.
    expect(attention.staleThresholdDays).toBe(DEFAULT_STALE_THRESHOLD_DAYS);
    expect(attention.unsubmittedThresholdDays).toBe(UNSUBMITTED_THRESHOLD_DAYS);
  });
});
