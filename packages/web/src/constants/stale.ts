/**
 * The client's copy of the stale definition (WIC-1479).
 *
 * The authority is `packages/api/src/services/stale.ts`. This file exists only
 * because `packages/web` and `packages/api` share no compiled module, the same
 * way `services/api/types.ts` hand-mirrors the API's response types.
 *
 * `stale.drift.test.ts` reads the API source as text and fails if these values
 * stop matching it, so the mirror cannot silently rot — which is the failure
 * mode WIC-1479 was filed about in the first place.
 *
 * Anything that can read the threshold off the wire should do that instead of
 * importing this: `AttentionCard` renders `attention.staleThresholdDays` so its
 * label always states the window the server actually applied.
 *
 * What is left are the surfaces with no aggregate to read — the report page's
 * threshold selector, which needs a value *before* any response arrives, and
 * `ApplicationsList` / `ApplicationCard`, which decide per row over a page they
 * already hold and never ask the server about staleness at all. Those two are
 * why `isStale` lives here: found in the review of PR #222 still carrying their
 * own 14-day-over-every-active-status rule, they were definitions 3 and 4 of the
 * seven WIC-1479 turned out to be about.
 */

import type { ApplicationStatus } from '../types/application';

/** Matches `DEFAULT_STALE_THRESHOLD_DAYS` in the API's `stale.ts`. */
export const DEFAULT_STALE_THRESHOLD_DAYS = 14;

/**
 * Matches `STALE_STATUSES` in the API's `stale.ts`. `saved` was never submitted
 * so there is nobody to chase; `interview` is an active conversation, not a
 * silence; the rest are terminal.
 */
export const STALE_STATUSES = [
  'applied',
  'phone_screen',
] as const satisfies readonly ApplicationStatus[];

/** The windows UC-5 US-5.7 specifies the report can be switched between. */
export const STALE_THRESHOLD_OPTIONS = [7, 14, 21, 30] as const;

/**
 * The instant a row must have been updated *before* to count as stale. Mirrors
 * `staleCutoff` in the API's `stale.ts` — same arithmetic, so the badge on a row
 * and the report's inclusion of that row cannot disagree at the boundary.
 */
export function staleCutoff(
  days: number = DEFAULT_STALE_THRESHOLD_DAYS,
  now: Date = new Date()
): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

/**
 * The client's one predicate for "stale", mirroring the API's `isStale`.
 *
 * Deliberately *not* `differenceInDays(startOfDay(now), updatedAt) >= days`,
 * which is what the two call sites used to compute: that rounds to whole
 * calendar days and disagrees with the server's instant comparison for rows
 * updated part-way through the boundary day. Same definition means same answer,
 * including at the edge.
 */
export function isStale(
  application: { status: ApplicationStatus; updatedAt: string | Date },
  options: { days?: number; now?: Date } = {}
): boolean {
  const { days = DEFAULT_STALE_THRESHOLD_DAYS, now } = options;
  if (!(STALE_STATUSES as readonly ApplicationStatus[]).includes(application.status)) return false;
  const updatedAt =
    application.updatedAt instanceof Date ? application.updatedAt : new Date(application.updatedAt);
  return updatedAt < staleCutoff(days, now);
}
