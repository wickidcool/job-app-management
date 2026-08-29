import { endOfDay, isValid, parseISO, startOfDay } from 'date-fns';
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

/** `<input type="date">` emits exactly this, or `''`. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A bound we cannot read is **ignored**, not treated as an empty window.
 *
 * The control cannot produce one, but a `localStorage` shortcut saved by an older build
 * can — `SavedFilterShortcuts` stores whatever `FilterOptions` it was handed and never
 * validates it on the way back in. Given corrupt input the choice is between showing
 * every row (the filter appears not to have applied) and showing none (indistinguishable
 * from data loss). We fail towards showing the data.
 */
function readBound(day: string | undefined): Date | null {
  if (!day || !CALENDAR_DAY.test(day)) return null;
  const parsed = parseISO(day);
  return isValid(parsed) ? parsed : null;
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
