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
 * label always states the window the server actually applied. This constant is
 * for the one place that needs a value *before* any response arrives — the
 * report page's threshold selector.
 */

/** Matches `DEFAULT_STALE_THRESHOLD_DAYS` in the API's `stale.ts`. */
export const DEFAULT_STALE_THRESHOLD_DAYS = 14;

/** The windows UC-5 US-5.7 specifies the report can be switched between. */
export const STALE_THRESHOLD_OPTIONS = [7, 14, 21, 30] as const;
