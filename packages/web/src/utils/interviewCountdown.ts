/**
 * The countdown `InterviewPrepCard` renders above a scheduled interview.
 *
 * ## Why this is a module and not eight lines inside the component
 *
 * The ladder has eight rungs and three of them were wrong for three different reasons (below).
 * None of the three was reachable from a page-level test:
 * `InterviewPrepPage.interviewDate.test.tsx` pins the countdown at *exactly* 72 hours out,
 * which is the one offset where the old elapsed-time arithmetic and the calendar arithmetic
 * below agree. A test that can only reach one rung cannot pin the other seven, so the rungs
 * got a pure function they can address directly.
 *
 * ## 1. Days are CALENDAR days, local — not `Math.ceil` of elapsed milliseconds
 *
 * The old code read `Math.ceil(diffMs / DAY_MS)`, which answers "how many 24-hour blocks,
 * rounded up" — a different question from the one the words `Tomorrow` and `In 2 days` ask.
 * The two diverge almost everywhere:
 *
 * | interview is | elapsed-ceil said | calendar says |
 * |---|---|---|
 * | 25 hours away (tomorrow evening) | `In 2 days` | `Tomorrow` |
 * | 36 hours away | `In 2 days` | `Tomorrow` |
 * | 47 hours away | `In 2 days` | `In 2 days` |
 *
 * So `Tomorrow` rendered for a **60-minute window** — offsets in (23h, 24h] — out of the
 * ~24-hour band it names, and everything else that was genuinely tomorrow was announced as
 * two days out. That understates urgency by a full day on the one screen whose entire job
 * is telling you how long you have left to prepare.
 *
 * This is the same defect class, and the same resolution, as `interviewWeek.ts` (WIC-2194):
 * interview dates are reasoned about in **calendar units in the browser's timezone**,
 * because *"an off-by-one-day interview filter is indistinguishable from a correct one
 * until someone misses an interview."* A countdown is that filter's per-row twin.
 *
 * `calendarDaysBetween` normalises both instants to local midnight and rounds, so a DST
 * boundary — a calendar day that is really 23 or 25 hours long — still counts as one day.
 * Subtracting raw timestamps and flooring would count the short day as zero.
 *
 * ## 2. The guards FAIL OPEN on an unparseable date
 *
 * `new Date('nonsense').getTime()` is `NaN`, and **every** comparison against `NaN` is
 * false — so `diffMs < 0`, `diffMinutes < 120`, `diffHours < 24` and all three `diffDays`
 * tests fell through in order, landing on a final unconditional `return` that rendered
 * `In NaN days`. Each guard individually looks like it would catch a bad value; the failure
 * is that they all decline together and the last statement is not a guard at all.
 *
 * Returning `null` puts a malformed date in the same state as an absent one, which the
 * component already handles by rendering nothing. That is the honest state: we do not know
 * when this interview is, so we say nothing rather than inventing a number.
 *
 * ## 3. Sub-day rungs stay elapsed-time, deliberately
 *
 * `In 90 minutes` and `In 6 hours` are answering "how long have I got", where elapsed time
 * is exactly right and a calendar boundary is irrelevant — an interview at 09:00 tomorrow
 * seen at 23:00 tonight is better described as `In 10 hours` than as `Tomorrow`. Only the
 * rungs that use calendar *words* switched to calendar *arithmetic*.
 *
 * ## 4. `diffDays === 0` needs its own rung, between the hours rung and `Tomorrow`
 *
 * Switching the day rungs to calendar arithmetic made `0` reachable for the first time:
 * `Math.ceil(diffMs / DAY_MS)` cannot return `0` for a positive `diffMs`, but
 * `calendarDaysBetween` returns it for every interview later on today's date. The two rungs
 * that bracket it both decline — `diffHours < 24` is false once `Math.ceil` has rolled to 24,
 * and neither calendar-word rung matches `0` — so it reached the default and rendered the
 * literal string `In 0 days`.
 *
 * The band is `diffMs` in (23h, 24h) with an unchanged local date, which requires the clock
 * to read 00:00-00:58: **59 `now` minutes per ordinary day**, and **119** on a 25-hour
 * fall-back DST day, where the extra hour widens it. A spring-forward 23-hour day cannot
 * reach it at all.
 *
 * The rung sits *below* the hours rung on purpose. Placing it above would catch every
 * same-day interview, turning `In 6 hours` into `Today` and discarding the precision on the
 * offsets where it matters most.
 *
 * The old elapsed-time code was also wrong here — it said `Tomorrow` for an interview
 * happening *today* — so this is not a regression the calendar switch introduced so much as
 * one it made visible, and made ungrammatical.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type CountdownUrgency = 'critical' | 'high' | 'medium' | 'low' | 'neutral' | 'past';

export interface InterviewCountdown {
  text: string;
  urgency: CountdownUrgency;
}

/**
 * Whole calendar days from `from` to `to` in the **local** timezone.
 *
 * Both instants are collapsed to their own local midnight before subtracting, so the result
 * counts date boundaries crossed rather than 24-hour blocks elapsed: 23:00 today to 01:00
 * tomorrow is `1`, and 01:00 today to 23:00 today is `0`.
 *
 * `Math.round` rather than a plain division because a local day spanning a DST transition is
 * 23 or 25 hours long; rounding absorbs that, truncation would not.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(to) - midnight(from)) / DAY_MS);
}

/**
 * The countdown label and urgency for a scheduled interview, or `null` when there is nothing
 * honest to say — no date, or a date that does not parse.
 *
 * `now` is injectable so tests can pin an offset without touching the system clock; the
 * component omits it.
 */
export function interviewCountdown(
  interviewDate: string | undefined,
  now: Date = new Date()
): InterviewCountdown | null {
  if (!interviewDate) {
    return null;
  }

  const target = new Date(interviewDate);
  const diffMs = target.getTime() - now.getTime();

  // Explicitly, before the ladder: NaN loses every comparison below, so an unparseable date
  // would otherwise reach the final `return` and render "In NaN days".
  if (Number.isNaN(diffMs)) {
    return null;
  }

  if (diffMs < 0) {
    return { text: 'Interview completed', urgency: 'past' };
  }

  const diffMinutes = Math.ceil(diffMs / MINUTE_MS);
  if (diffMinutes < 120) {
    return { text: `In ${diffMinutes} minutes`, urgency: 'critical' };
  }

  const diffHours = Math.ceil(diffMs / HOUR_MS);
  if (diffHours < 24) {
    return { text: `In ${diffHours} hours`, urgency: 'high' };
  }

  const diffDays = calendarDaysBetween(now, target);
  // Below the hours rung deliberately, so a same-day interview six hours out still gets the
  // more precise "In 6 hours". Above `Tomorrow` because without it a `0` falls through every
  // remaining test to the default and renders "In 0 days" — see §4 of the header.
  if (diffDays === 0) {
    return { text: 'Today', urgency: 'high' };
  }

  if (diffDays === 1) {
    return { text: 'Tomorrow', urgency: 'medium' };
  }

  if (diffDays === 2) {
    return { text: 'In 2 days', urgency: 'medium' };
  }

  return { text: `In ${diffDays} days`, urgency: diffDays <= 7 ? 'low' : 'neutral' };
}
