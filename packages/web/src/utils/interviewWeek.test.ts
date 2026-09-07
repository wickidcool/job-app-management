import { describe, it, expect } from 'vitest';
import { interviewWeekWindow, toApiInstant } from './interviewWeek';

/**
 * WIC-2194 — the calendar week behind `Interviews This Week`.
 *
 * Two properties matter, and they fail in opposite ways. The **shape** decides whether the
 * request is a 200 or a 400, and gets caught immediately. The **boundaries** decide
 * whether the right rows come back, and a one-day error there is invisible: a window
 * shifted by a day still returns a plausible list of interviews, and the only symptom is
 * an interview the user never saw.
 */
describe('toApiInstant', () => {
  /**
   * The regex `zod`'s `.datetime({ offset: true })` compiles to, which is what
   * `GET /api/applications` validates both bounds with. A date-only bound is a **400**
   * there on purpose — it would otherwise parse as UTC midnight and shift the window by
   * up to a day for anyone west of Greenwich.
   */
  const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

  it('emits an offset-bearing instant, not a calendar day', () => {
    const iso = toApiInstant(new Date(2026, 8, 7, 9, 30, 15, 250));

    expect(iso).toMatch(ISO_WITH_OFFSET);
    // The negative control: the sibling `dateRange` filter uses `YYYY-MM-DD`, and sending
    // that shape here is the mistake this format exists to prevent.
    expect(iso).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps milliseconds — the upper bound is 23:59:59.999', () => {
    // `formatISO` truncates to whole seconds, which would exclude an interview stored at
    // 23:59:59.500 from the week the user is looking at.
    expect(toApiInstant(new Date(2026, 8, 13, 23, 59, 59, 999))).toContain('T23:59:59.999');
  });

  it('renders the local wall-clock time, not a UTC conversion of it', () => {
    // Whatever the runner's zone, `00:00:00.000` local must be *stated* as 00:00 with an
    // offset attached — not silently converted to some other hour in UTC. That conversion
    // is what makes an off-by-one-day window look correct.
    expect(toApiInstant(new Date(2026, 8, 7, 0, 0, 0, 0))).toMatch(
      /^2026-09-07T00:00:00\.000(Z|[+-]\d{2}:\d{2})$/
    );
  });
});

describe('interviewWeekWindow', () => {
  // A Wednesday. Deliberately mid-week: a bug that returns "today through Sunday" or
  // "the next 7 days" is indistinguishable from the correct answer when measured on a
  // Monday, which is the single most likely day for someone to eyeball this by hand.
  const WEDNESDAY = new Date(2026, 8, 9, 14, 30, 0, 0);

  it('starts on Monday at 00:00:00.000 local', () => {
    expect(interviewWeekWindow(WEDNESDAY).from).toMatch(/^2026-09-07T00:00:00\.000/);
  });

  it('ends on Sunday at 23:59:59.999 local', () => {
    expect(interviewWeekWindow(WEDNESDAY).to).toMatch(/^2026-09-13T23:59:59\.999/);
  });

  it('is the calendar week, not a rolling seven days from now', () => {
    // The distinguishing case, and the reason the ruling chose calendar week: a rolling
    // window from Wednesday would start on the 9th and end on the 16th, hiding Monday's
    // and Tuesday's interviews — which is precisely what "this week" does not mean.
    const { from, to } = interviewWeekWindow(WEDNESDAY);
    expect(from).not.toMatch(/^2026-09-09/);
    expect(to).not.toMatch(/^2026-09-16/);
  });

  it('includes days earlier in the week that have already passed', () => {
    // "Rest of the week" was the third option and was rejected: this filter's purpose is
    // "did I miss one", so Monday must stay in the window when asked on Wednesday.
    const monday = new Date(2026, 8, 7, 10, 0, 0, 0).getTime();
    const { from, to } = interviewWeekWindow(WEDNESDAY);
    expect(new Date(from).getTime()).toBeLessThanOrEqual(monday);
    expect(new Date(to).getTime()).toBeGreaterThanOrEqual(monday);
  });

  it('treats Sunday as the end of the week it closes, not the start of the next', () => {
    // date-fns defaults to `weekStartsOn: 0` (Sunday). If the explicit `{ weekStartsOn: 1 }`
    // is ever dropped, this is the assertion that reddens: under the default, Sunday the
    // 13th would open a *new* week running to the 19th.
    const sunday = new Date(2026, 8, 13, 12, 0, 0, 0);
    expect(interviewWeekWindow(sunday).from).toMatch(/^2026-09-07/);
    expect(interviewWeekWindow(sunday).to).toMatch(/^2026-09-13/);
  });

  it('produces a non-inverted range the API will accept', () => {
    // The API 400s an inverted range rather than returning a silent empty page. Any week
    // it is asked about must satisfy from <= to.
    for (const day of [0, 1, 3, 5, 6]) {
      const { from, to } = interviewWeekWindow(new Date(2026, 8, 7 + day, 13, 0, 0, 0));
      expect(new Date(from).getTime()).toBeLessThanOrEqual(new Date(to).getTime());
    }
  });

  it('spans seven days, not six or eight', () => {
    // Tolerant of an hour either way ON PURPOSE. The window is defined in local wall-clock
    // terms, so a week containing a DST transition is legitimately 23 or 25 hours short or
    // long — asserting an exact `7 * 24h - 1ms` would red in any zone whose clocks happen
    // to change that week (Chile shifts in early September) while proving nothing extra.
    // The tolerance is far narrower than the error this catches, which is a whole day.
    const HOUR = 60 * 60 * 1000;
    const span =
      new Date(interviewWeekWindow(WEDNESDAY).to).getTime() -
      new Date(interviewWeekWindow(WEDNESDAY).from).getTime();

    expect(span).toBeGreaterThan(7 * 24 * HOUR - HOUR - 1);
    expect(span).toBeLessThan(7 * 24 * HOUR + HOUR);
  });
});
