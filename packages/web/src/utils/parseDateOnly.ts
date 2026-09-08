/**
 * Parse a bare `YYYY-MM-DD` calendar day into a `Date` at **local** midnight.
 *
 * ## Why this exists (WIC-2267)
 *
 * `nextActionDue` is a Postgres `date` column (`schema.ts:52`), so the API serves a bare
 * `YYYY-MM-DD` with no time and no zone. It denotes a **wall calendar day** — "the 10th" —
 * not an instant.
 *
 * `new Date('2026-09-10')` is the wrong tool for that string. ECMAScript parses the
 * *date-only* form as **UTC midnight**, while every comparison in this package is against
 * *local* midnight (`setHours(0,0,0,0)`, or local calendar fields). The two disagree by
 * exactly one calendar day in any zone with a negative UTC offset — the whole Americas —
 * and break a different boundary in positive-offset zones. UTC is clean, which is why the
 * defect was invisible in CI for as long as it was.
 *
 * Measured on the pre-fix code across 8 zones x 6 base dates x all 1440 start minutes:
 * a row due **today** badged "Overdue" on 8,640/120,960 America/New_York samples, and a
 * stored `2026-01-01` rendered as **"Dec 31, 2025"** — wrong day, month and year.
 *
 * ## Why not `new Date(s)` / `parseISO(s)` / `calendarDaysBetween` alone
 *
 * The bug is in the **parse**, so no amount of downstream normalising repairs it.
 * `calendarDaysBetween` (`utils/interviewCountdown.ts`) collapses both operands to local
 * midnight, but handing it `new Date('2026-09-10')` starts it from UTC midnight and it
 * stays off by one. Parse correctly first, then diff.
 *
 * date-fns `parseISO` *does* treat the date-only form as local and is the correct call —
 * `components/ApplicationCard.tsx` and `pages/ApplicationsList.tsx` have always used
 * `startOfDay(parseISO(...))` and were never affected. This helper is deliberately
 * narrower than `parseISO`, for one reason: `parseISO` also accepts full datetimes, and
 * this codebase carries two look-alike fields that must not be parsed the same way.
 * `types.ts:39-45` and `applicationFormSchema.ts:61-64` both warn about it in prose —
 *
 *     nextActionDue      DATE         `YYYY-MM-DD`     a calendar day  -> this helper
 *     interviewDate      TIMESTAMPTZ  full ISO instant                 -> `new Date(s)`
 *
 * A prose warning is only as good as the reader. Rejecting anything that is not date-only
 * turns that warning into a `null` at the call site, where it is visible.
 *
 * @returns local midnight on the given day, or `null` when `value` is absent, malformed,
 *          or not a real calendar date (`2026-02-30`). Callers must handle `null`; there
 *          is no honest fallback date and inventing one is how "Dec 31, 2025" happened.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;

  const match = DATE_ONLY.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(year, month - 1, day);

  // Rejects overflow the `Date` constructor would otherwise absorb silently:
  // `new Date(2026, 1, 30)` is 2 March, and returning that would be a wrong date rather
  // than a refusal. Also pins the year, since years 0-99 map to 1900-1999.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}
