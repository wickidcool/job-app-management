import { and, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { applications } from '../db/schema.js';
import type { ApplicationStatus } from '../types/index.js';

/**
 * The single definition of "stale" (WIC-1479).
 *
 * The product shipped **seven** of these. The card found three; the review of
 * PR #222 found two more; the tree-wide scan written to answer that review
 * found the last two:
 *
 *   1. the dashboard attention card: every non-terminal status, over a
 *      hardcoded 7 days;
 *   2. the dashboard quick-wins list: `applied`/`phone_screen`/`interview`,
 *      over the same 7 days;
 *   3. the applications list's pipeline tile ("Stale (14+ days)"): every
 *      *active* status — so `saved` and `interview` too — at 14 days;
 *   4. `ApplicationCard`'s "Stale" badge: every non-terminal status at 14 days;
 *   5. `ReportsPipeline`'s local `isStale` helper, behind its "⏱️ Stale" badge:
 *      14 days and **no status check at all**;
 *   6. a second copy of that rule inlined in the same page's stats memo, behind
 *      its own "Stale (14+ days)" tile;
 *   7. `/reports/stale`: `applied`/`phone_screen` over 14 days.
 *
 * Only no. 7 was ever specified (UC-5 US-5.7, WIC-143), and it is the one this
 * module encodes. Nos. 3–6 agreed with it on the threshold and differed on the
 * status set, which is why they outlived the first pass: every guard aimed at
 * the number 7, or at this file's own text, walked straight past them. At 20
 * days an `interview` row was badged "Stale" in four places and absent from the
 * report.
 *
 * The attention card links straight to the report, so a user was shown a count
 * and then a report that contradicted it — see WIC-1479's failure scenario,
 * which reproduces on an account holding three applications.
 *
 * The report was the conformant surface: UC-5 US-5.7 (WIC-143) specifies
 * "applications in `applied` or `phone_screen` status with no status change in
 * 14+ days", configurable to 7/14/21/30. The dashboard was drifted because it
 * was never specified at all. So this module encodes the report's definition and
 * both surfaces now read it.
 *
 * Everything here is one definition expressed once. `staleWhere` is the only
 * predicate any query should use, and `isStale` is its in-memory mirror for
 * tests. Do not re-inline a status list or a day count at a call site: the
 * drift guard in `test/stale.definition.test.ts` fails if you do.
 */

/**
 * Statuses that can go stale. Terminal statuses (`offer`, `rejected`,
 * `withdrawn`) cannot, and neither can `saved` — a saved application was never
 * submitted, so there is nobody to follow up with. `interview` is excluded by
 * the spec as well; see the note in `test/stale.definition.test.ts`.
 */
export const STALE_STATUSES = [
  'applied',
  'phone_screen',
] as const satisfies readonly ApplicationStatus[];

/** UC-5 US-5.7's default window. The report's selector offers 7/14/21/30. */
export const DEFAULT_STALE_THRESHOLD_DAYS = 14;

/** Bounds an untrusted `?days=` query parameter is clamped into. */
export const MIN_STALE_THRESHOLD_DAYS = 1;
export const MAX_STALE_THRESHOLD_DAYS = 365;

/**
 * Resolves a caller-supplied day count to the window actually applied, filling
 * in the default and clamping out-of-range input.
 */
export function resolveStaleThresholdDays(days?: number): number {
  const requested = days ?? DEFAULT_STALE_THRESHOLD_DAYS;
  return Math.min(Math.max(requested, MIN_STALE_THRESHOLD_DAYS), MAX_STALE_THRESHOLD_DAYS);
}

/**
 * The instant an application must have been updated *before* to count as stale.
 */
export function staleCutoff(
  days: number = DEFAULT_STALE_THRESHOLD_DAYS,
  now: Date = new Date()
): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

interface StaleOptions {
  /** Defaults to `DEFAULT_STALE_THRESHOLD_DAYS`. Already-resolved, not clamped again. */
  days?: number;
  /**
   * Narrows `STALE_STATUSES`. Only `/reports/stale`'s `?status=` filter passes
   * this; it can subset the definition but never widen it. An empty set is
   * legal and means "no row is stale" — see `staleWhere`.
   */
  statuses?: readonly ApplicationStatus[];
  now?: Date;
}

/**
 * The one SQL predicate for "stale". Both `getDashboardStats` and
 * `getStaleReport` build their queries from this call, which is what makes the
 * dashboard count and the report's row count equal by construction rather than
 * by assertion (WIC-1479 AC-N2b).
 */
export function staleWhere(options: StaleOptions = {}): SQL | undefined {
  const { days = DEFAULT_STALE_THRESHOLD_DAYS, statuses = STALE_STATUSES, now } = options;
  // An empty status set is a legitimate request, not a caller error:
  // `/reports/stale?status=saved` narrows the definition down to nothing, and
  // the honest answer is an empty report. drizzle's `inArray` throws on an
  // empty list ("inArray requires at least one value"), which would surface as
  // a 500. So express "matches no row" directly, at the definition, where every
  // caller inherits it rather than each remembering to pre-check.
  if (statuses.length === 0) return sql`1 = 0`;
  return and(
    inArray(applications.status, [...statuses]),
    lt(applications.updatedAt, staleCutoff(days, now))
  );
}

/**
 * In-memory mirror of `staleWhere`, for tests and for any caller reasoning about
 * a row it already holds.
 *
 * This is deliberately written in terms of the same `STALE_STATUSES` and
 * `staleCutoff` the SQL predicate uses, so the only thing duplicated between the
 * two is the comparison operator — and `stale.definition.test.ts` pins the SQL
 * operator to `<` so the pair cannot silently diverge.
 */
export function isStale(
  application: { status: ApplicationStatus; updatedAt: Date | string },
  options: StaleOptions = {}
): boolean {
  const { days = DEFAULT_STALE_THRESHOLD_DAYS, statuses = STALE_STATUSES, now } = options;
  if (!statuses.includes(application.status)) return false;
  const updatedAt =
    application.updatedAt instanceof Date ? application.updatedAt : new Date(application.updatedAt);
  return updatedAt < staleCutoff(days, now);
}
