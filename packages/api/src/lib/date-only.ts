/**
 * Helpers for Postgres `date` columns, which drizzle serves as bare `YYYY-MM-DD`
 * strings (`date(..., { mode: 'string' })`).
 *
 * WIC-2268. Two hazards, and they fire in *complementary* timezones -- which is why
 * fixing only one of them leaves the function broken for half the world:
 *
 *   1. `new Date('2026-09-10')` parses a date-only form as **UTC midnight** (ECMAScript
 *      date-time string format). Comparing that against a **local** midnight is off by
 *      one calendar day in every negative-offset zone (the Americas).
 *
 *   2. `localMidnight.toISOString().slice(0, 10)` converts back through UTC, so in every
 *      **positive**-offset zone it yields the *previous* calendar day.
 *
 * Both are silent under `TZ=UTC`, which is why they survive CI.
 */

/** Parse a bare `YYYY-MM-DD` as midnight in the **local** zone (not UTC). */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Format a Date as `YYYY-MM-DD` using its **local** calendar fields (not UTC). */
export function formatDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Whole calendar days from `from` to `to`, both taken at local midnight.
 *
 * Uses `Math.round`, not `Math.floor`: across a spring-forward DST boundary the
 * elapsed time between two local midnights is 23h, so `floor` reports one day fewer.
 * Measured under WIC-2268 -- `floor` is wrong on 2017/14420 sampled rows in
 * `America/New_York` and 1914/14420 in `Europe/Berlin` even *after* the parse is fixed.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
