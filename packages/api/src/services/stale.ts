import { and, inArray, lt, type SQL } from 'drizzle-orm';
import { applications } from '../db/schema.js';
import type { ApplicationStatus } from '../types/index.js';

/**
 * The single definition of "stale" (WIC-1479).
 *
 * The product previously shipped three of these: the dashboard attention card
 * counted every non-terminal status over a hardcoded 7 days, the dashboard
 * quick-wins list counted `applied`/`phone_screen`/`interview` over the same 7
 * days, and `/reports/stale` counted `applied`/`phone_screen` over 14. The card
 * links straight to the report, so a user was shown a count and then a report
 * that contradicted it — see WIC-1479's failure scenario, which reproduces on an
 * account holding three applications.
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
   * this; it can subset the definition but never widen it.
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
