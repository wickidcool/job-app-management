import { endOfDay, format, isValid, parseISO, startOfDay } from 'date-fns';
import type { Application } from '../types/application';

/**
 * WIC-1613 — US-6.3's third acceptance clause is "Filter by status, company, **date**".
 *
 * Two things about "date" were never operatively defined by the requirement, and each
 * layer would otherwise have invented its own reading. Both are settled here, once, so
 * there is a single place to read the answer and a single place to change it.
 *
 * ## 1. WHICH date
 *
 * `Application` carries three, and they filter to different sets:
 *
 * - `createdAt` — when the user saved the opportunity (always present)
 * - `appliedAt` — when they actually applied (**optional**; absent for every `saved` row)
 * - `updatedAt` — last touched by anything at all, including a status change
 *
 * We use **`appliedAt`, falling back to `createdAt`** — "the date this landed in my
 * pipeline". `updatedAt` is rejected outright: it moves when a status changes, so a row
 * would silently leave and re-enter a fixed window without the user doing anything to
 * it, which is not a property anyone can filter on usefully.
 *
 * The fallback is what makes the filter total: `saved` rows have no `appliedAt`, and a
 * date filter that silently dropped every saved row would contradict the same AC row's
 * "dashboard showing **all** my applications". The control is labelled
 * "Date added / applied" in `FilterPanel` so the user is told this rather than left to
 * infer it from which rows vanish.
 *
 * ## 2. Bounds are LOCAL CALENDAR DAYS, and both ends are INCLUSIVE
 *
 * `start`/`end` are `YYYY-MM-DD` strings, not `Date`s, for three reasons:
 *
 * - it is exactly what `<input type="date">` reads and writes, so no conversion sits
 *   between the control and the state;
 * - `SavedFilterShortcuts` persists whole `FilterOptions` objects through
 *   `JSON.stringify`/`JSON.parse` into `localStorage`. A `Date` does not survive that
 *   round trip — it comes back as a **string still typed as `Date`**, so a saved
 *   shortcut carrying a date range would typecheck and then throw at the first
 *   `.getTime()`. Storing the string makes the persisted and live shapes identical;
 * - it matches the convention already set by `Application.nextActionDue`
 *   (`// ISO date (YYYY-MM-DD)`).
 *
 * A row's timestamp is an instant; a bound is a day the user typed in their own
 * timezone. `parseISO` reads a date-only string as **local** midnight, so
 * `startOfDay(start)`..`endOfDay(end)` is the local day the user meant, and the last
 * day of the range is included — picking 1 Mar–31 Mar includes the 31st.
 */
export interface DateRangeFilter {
  /** Inclusive lower bound, local calendar day, `YYYY-MM-DD`. */
  start?: string;
  /** Inclusive upper bound, local calendar day, `YYYY-MM-DD`. */
  end?: string;
}

/**
 * Reads one bound into the local day it denotes, or `null` if it denotes no day.
 *
 * A bound we cannot read is **ignored**, not treated as an empty window. The control
 * cannot produce one — `<input type="date">` emits `YYYY-MM-DD` or `''` — but a
 * `localStorage` shortcut can: `SavedFilterShortcuts` stores whatever `FilterOptions` it
 * was handed and never validates it on the way back in. Given corrupt input the choice
 * is between showing every row (the filter visibly did not apply) and showing none
 * (indistinguishable from data loss). We fail towards showing the data.
 *
 * **The guard is a round trip, not a pattern match.** An earlier draft gated on
 * `/^\d{4}-\d{2}-\d{2}$/`, and deleting that regex's anchors changed no test result —
 * a shape guard that can be silently disarmed is not a guard. Formatting the parsed
 * date back and requiring it to equal the input is self-checking: only a string that
 * really is one calendar day survives, and there is no pattern to drift. It rejects
 * `2026-13-45` and `2026-02-30` (which a regex accepts), `20260301` and `2026-3-1`
 * (wrong shape), and text trailing the day (`2026-03-01 was the day`).
 *
 * The round trip covers the **first ten characters only**. What follows them is checked
 * just for a `T` separator, so `2026-03-01Thursday` reads as 1 Mar 2026 rather than
 * being rejected. Deliberate: the time part is discarded regardless, so the day is still
 * right, and fail-soft is the point for a value that reaches us from `localStorage`.
 *
 * A full ISO timestamp is accepted and reduced to its **date part**, so it is read as a
 * local calendar day like every other bound rather than as the UTC instant `parseISO`
 * would otherwise make of it. That is what `JSON.stringify` does to a `Date`, so it is
 * the shape any shortcut saved against the old `{ start: Date; end: Date }` type would
 * carry.
 */
function readBound(day: string | undefined): Date | null {
  if (typeof day !== 'string') return null;

  const trimmed = day.trim();
  const dayPart = trimmed.slice(0, 10);
  const rest = trimmed.slice(10);
  // The round trip below only ever sees the first ten characters, so this rejects a
  // string whose day is followed by something that is not a time separator —
  // `2026-03-01x`, `2026-03-01 was the day`. It is a separator check, not a time
  // parser: `2026-03-01T`, `2026-03-01Tzzzzz` and `2026-03-01Thursday` all pass here
  // and read as 1 Mar 2026. That is deliberate — the time is discarded either way, so
  // the day is still correct, and this is the fail-soft path for a corrupt
  // `localStorage` bound. Do not read it as validating what follows the `T`.
  if (rest !== '' && !rest.startsWith('T')) return null;

  const parsed = parseISO(dayPart);
  if (!isValid(parsed)) return null;
  return format(parsed, 'yyyy-MM-dd') === dayPart ? parsed : null;
}

/**
 * The single date US-6.3's "filter by date" is about. See the header note: `appliedAt`
 * when the user has applied, `createdAt` — the day they saved it — when they have not.
 */
export function applicationFilterDate(
  application: Pick<Application, 'createdAt' | 'appliedAt'>
): Date | null {
  const when = application.appliedAt ?? application.createdAt;
  if (when === undefined || when === null) return null;
  const asDate = when instanceof Date ? when : new Date(when);
  return isValid(asDate) ? asDate : null;
}

/** True when `range` asks for nothing, so no row can be excluded by it. */
export function isEmptyDateRange(range: DateRangeFilter | undefined): boolean {
  return readBound(range?.start) === null && readBound(range?.end) === null;
}

/**
 * Whether one row falls inside the window. Both bounds are optional and independent, so
 * a half-open range ("everything since 1 March") is expressible — which is the common
 * case, and the reason `DateRangeFilter` widened the old `{ start: Date; end: Date }`
 * fossil to make each end optional.
 *
 * A row whose date cannot be resolved at all is **excluded** while a range is active.
 * That is the opposite of `readBound`'s fail-open and deliberately so: the user asked
 * for a window, and a row with no knowable date is not demonstrably in it. Every
 * `Application` has a required `createdAt`, so this is unreachable through the real
 * service — it is stated, and pinned by a test, because `NaN` compares false against
 * both bounds and would otherwise make the behaviour an accident rather than a decision.
 */
export function isWithinDateRange(
  application: Pick<Application, 'createdAt' | 'appliedAt'>,
  range: DateRangeFilter | undefined
): boolean {
  const start = readBound(range?.start);
  const end = readBound(range?.end);
  if (start === null && end === null) return true;

  const when = applicationFilterDate(application);
  if (when === null) return false;

  if (start !== null && when < startOfDay(start)) return false;
  if (end !== null && when > endOfDay(end)) return false;
  return true;
}

/** `isWithinDateRange` over a list. Returns the input untouched for an empty range. */
export function filterByDateRange<T extends Pick<Application, 'createdAt' | 'appliedAt'>>(
  applications: T[],
  range: DateRangeFilter | undefined
): T[] {
  if (isEmptyDateRange(range)) return applications;
  return applications.filter((application) => isWithinDateRange(application, range));
}
