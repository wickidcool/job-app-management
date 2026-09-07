import { endOfWeek, format, startOfWeek } from 'date-fns';

/**
 * WIC-2194 — the calendar week the `Interviews This Week` shortcut promises.
 *
 * ## Why this file exists
 *
 * `docs/design/SAVED_FILTER_SHORTCUT_NAMING.md` (WIC-1775) renamed this shortcut to
 * `Interviewing` because the filter carried no window, and rejected the alternative fix
 * — "give the filter the window its label promises" — on one stated condition: *"there
 * is no interview-date field to filter on."* That condition has since flipped
 * (WIC-2023 added the column, WIC-2188 the writer, WIC-2189 the query params), and the
 * ruling was revisited in favour of applying the window. This is that window.
 *
 * ## 1. WHICH week — calendar, not rolling
 *
 * **Monday 00:00:00.000 through Sunday 23:59:59.999, in the browser's timezone.**
 *
 * A rolling seven days from now is honestly labelled `Next 7 Days`; calling it
 * `This Week` would re-create in miniature the very label-vs-filter defect the ruling
 * exists to prevent. "Rest of the week" was rejected for a different reason: it hides
 * interviews earlier in the week that already happened, which is not what "this week"
 * means to anyone reading it — and this filter's whole purpose is *"did I miss one?"*.
 *
 * ⚠️ **`FilterPanel`'s own `This Week` preset starts on SUNDAY** (`startOfWeek` with
 * date-fns' default `weekStartsOn: 0`) and ends *today* rather than at end of week. That
 * is a different control over a different field (date added/applied, per
 * `dateRangeFilter.ts`), so the two are not interchangeable — but they do disagree about
 * which day a week starts. Left alone deliberately: changing a shipped preset's meaning
 * is outside this card, and silently deviating from the ruling's explicit
 * "Monday 00:00:00.000 to Sunday 23:59:59.999" to match it would be worse. Noted in the
 * ruling doc so the next person finds it stated rather than rediscovers it.
 *
 * ## 2. Bounds are INSTANTS WITH OFFSET, not `YYYY-MM-DD`
 *
 * This is the one constraint that turns a silent wrong answer into a loud failure, and
 * it is the opposite of the convention the sibling `dateRange` filter uses.
 *
 * `GET /api/applications` validates both bounds with
 * `z.string().datetime({ offset: true })` (`routes/applications.ts`), so a date-only
 * `2026-09-07` is a **400 `VALIDATION_ERROR`**, not a silent shift. The API rejects it on
 * purpose: `new Date('2026-09-07')` reads as *UTC* midnight, which moves the window by up
 * to a day for any user west of Greenwich, and an off-by-one-day interview filter is
 * indistinguishable from a correct one until someone misses an interview.
 *
 * So the conversion from "Monday, local" to an instant is real work, done here, once.
 * `xxx` emits the browser's own offset (`+02:00`, or `Z` for UTC), which is what makes
 * the instant mean the local wall-clock time the user is thinking in.
 *
 * ## 3. The bounds stay STRINGS
 *
 * `SavedFilterShortcuts` round-trips whole `FilterOptions` objects through
 * `JSON.stringify`/`JSON.parse` into `localStorage`. A `Date` does not survive that — it
 * returns as a string still *typed* as `Date`, which typechecks and then throws at the
 * first `.getTime()`. Same reasoning as `DateRangeFilter`, and the same conclusion.
 *
 * ## 4. A NULL interview date needs no extra flag
 *
 * The API applies each bound as `gte`/`lte` on `applications.interview_date`, and SQL
 * comparison against `NULL` is never true — so rows with no interview scheduled fall out
 * of the window on their own. The shortcut shows exactly the scheduled interviews without
 * an `activeOnly`-style companion filter. Pinned in
 * `packages/api/test/application-interview-date-filter.test.ts`.
 */
export interface InterviewDateWindow {
  /** Inclusive lower bound, ISO-8601 **with offset**. */
  from: string;
  /** Inclusive upper bound, ISO-8601 **with offset**. */
  to: string;
}

/**
 * ISO-8601 with milliseconds and an explicit numeric offset — `2026-09-07T00:00:00.000+02:00`.
 *
 * Millisecond precision is not decorative: the upper bound is `23:59:59.999`, and an
 * `interview_date` stored at `23:59:59.500` sits inside the week the user is looking at.
 * Truncating to whole seconds (as `formatISO` does) would drop it.
 */
export function toApiInstant(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
}

/**
 * The current calendar week as an inclusive instant range in the browser's timezone.
 *
 * `now` is injectable so tests can pin a week without touching the system clock; every
 * production caller omits it. Callers must resolve this **at click time**, never at module
 * load: a tab left open across Sunday midnight would otherwise keep filtering to last week
 * under a label saying "this".
 */
export function interviewWeekWindow(now: Date = new Date()): InterviewDateWindow {
  return {
    from: toApiInstant(startOfWeek(now, { weekStartsOn: 1 })),
    to: toApiInstant(endOfWeek(now, { weekStartsOn: 1 })),
  };
}
