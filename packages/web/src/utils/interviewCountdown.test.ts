import { describe, it, expect, afterEach } from 'vitest';
import { interviewCountdown, calendarDaysBetween } from './interviewCountdown';

/**
 * Every rung of the countdown ladder, addressed directly.
 *
 * `InterviewPrepPage.interviewDate.test.tsx` pins the countdown through the page, at exactly
 * 72 hours out. That is the single offset where the old `Math.ceil(diffMs / DAY_MS)` and the
 * calendar arithmetic that replaced it return the same answer, so the page test stayed green
 * across the whole defect and could not have caught it. These tests exist because a ladder
 * with eight rungs needs eight assertions, not one.
 *
 * Dates are built from local-time components (`new Date(y, m, d, h)`) rather than ISO strings
 * wherever the *calendar* boundary is the thing under test — an ISO string with a `Z` would
 * pin the assertion to UTC and quietly stop testing local-day semantics.
 */

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

/** Local wall-clock instant, so "which calendar day" means the browser's day. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('interviewCountdown — the regression: calendar days, not 24-hour blocks', () => {
  it('calls an interview 25 hours out "Tomorrow", not "In 2 days"', () => {
    // Mon 6 Sep 20:00 -> Tue 7 Sep 21:00. One date boundary crossed; 25 hours elapsed.
    // The old code ceil'd 25/24 to 2 and announced a full extra day of runway.
    const now = at(2026, 9, 6, 20);
    const interview = at(2026, 9, 7, 21);

    expect(interviewCountdown(interview.toISOString(), now)).toEqual({
      text: 'Tomorrow',
      urgency: 'medium',
    });
  });

  it('calls an interview 36 hours out "Tomorrow"', () => {
    // Mon 00:30 -> Tue 12:30. Still exactly one date boundary; old code said "In 2 days".
    expect(interviewCountdown(at(2026, 9, 8, 12, 30).toISOString(), at(2026, 9, 7, 0, 30))).toEqual(
      { text: 'Tomorrow', urgency: 'medium' }
    );
  });

  it('covers the WHOLE of tomorrow, not a 60-minute window', () => {
    // The old ladder reached "Tomorrow" only for offsets in (23h, 24h]: below that the
    // `diffHours < 24` rung caught it, above it `Math.ceil` had already rolled to 2.
    // Sweep every half hour of the next calendar day from a fixed "now" just after midnight.
    const now = at(2026, 9, 7, 0, 30);
    const labels = new Set<string>();
    for (let half = 0; half < 48; half++) {
      const interview = at(2026, 9, 8, 0, 0);
      interview.setMinutes(interview.getMinutes() + half * 30);
      labels.add(interviewCountdown(interview.toISOString(), now)?.text ?? 'null');
    }
    // Everything on 8 Sep is "Tomorrow" — one label, no leakage into "In 2 days".
    expect([...labels]).toEqual(['Tomorrow']);
  });

  it('still says "In 2 days" for the day after tomorrow', () => {
    // The control for the case above: the fix must not swallow day 2 into "Tomorrow".
    expect(interviewCountdown(at(2026, 9, 9, 9).toISOString(), at(2026, 9, 7, 20))).toEqual({
      text: 'In 2 days',
      urgency: 'medium',
    });
  });
});

describe('interviewCountdown — the same-day rung', () => {
  /**
   * `diffDays === 0` is reachable and has its own rung, because the two rungs that bracket it
   * both decline: `diffHours < 24` is false once more than 23 hours have elapsed
   * (`Math.ceil` has rolled to 24), and the target is still on today's date so neither
   * `diffDays === 1` nor `=== 2` matches. Without a rung of its own that lands on the default
   * and renders the literal string `In 0 days`.
   *
   * TZ is pinned so the band is deterministic regardless of the runner's zone: the window is
   * `diffMs` in (23h, 24h) with an unchanged local date, which needs the clock to read
   * 00:00–00:58, and a DST transition inside the day would move `diffHours` off 24.
   */
  it('says "Today" for an interview later on the same calendar day', () => {
    process.env.TZ = 'America/New_York';
    // 00:00 -> 23:30 the same date: 23.5 hours elapsed, zero date boundaries crossed.
    expect(
      interviewCountdown(at(2026, 6, 10, 23, 30).toISOString(), at(2026, 6, 10, 0, 0))
    ).toEqual({ text: 'Today', urgency: 'high' });
  });

  it('leaves the hours rung alone for a same-day interview under a day out', () => {
    // The positive control: this case is also `diffDays === 0`, so a rung placed ABOVE the
    // hours rung rather than below it would turn "In 6 hours" into "Today" and lose the
    // precision that matters most. The two arms disagree, so the test above is live.
    process.env.TZ = 'America/New_York';
    expect(
      interviewCountdown(at(2026, 6, 10, 18, 0).toISOString(), at(2026, 6, 10, 12, 0))
    ).toEqual({ text: 'In 6 hours', urgency: 'high' });
  });

  it('holds on a 25-hour fall-back DST day, where the band is widest', () => {
    // America/New_York falls back 2026-11-01, making that local day 25 hours long. The extra
    // hour widens the exposed band from 59 `now` minutes to 119 — measured against the
    // unfixed ladder at minute resolution, and 0 on a 23-hour spring-forward day, which
    // cannot reach it at all. This is the worst case, so it gets its own assertion.
    process.env.TZ = 'America/New_York';
    // 00:00 EDT -> 23:30 EST the same date: 24.5 hours elapsed, still zero boundaries crossed,
    // so `Math.ceil` has rolled past 24 and only the calendar rung can answer.
    expect(
      interviewCountdown(at(2026, 11, 1, 23, 30).toISOString(), at(2026, 11, 1, 0, 0))
    ).toEqual({ text: 'Today', urgency: 'high' });
  });

  it('never renders "In 0 days" from any minute of a day', () => {
    // The defect stated as a sweep rather than as one instant. Every `now` minute of a
    // 24-hour day against every offset from 1 minute to 48 hours: the string must not appear.
    // At minute resolution the bad band is 59 `now` minutes per ordinary day, so a sweep that
    // steps `now` only hourly would miss it 23 times out of 24.
    process.env.TZ = 'America/New_York';
    for (let nowMin = 0; nowMin < 24 * 60; nowMin++) {
      const now = at(2026, 6, 10, 0, nowMin);
      for (let offset = 1; offset <= 48 * 60; offset += 7) {
        const target = new Date(now.getTime() + offset * 60_000);
        const text = interviewCountdown(target.toISOString(), now)?.text;
        if (text === 'In 0 days') {
          throw new Error(`"In 0 days" at now=${now.toISOString()} offset=${offset}min`);
        }
      }
    }
  });
});

describe('interviewCountdown — an unparseable date fails CLOSED', () => {
  it('returns null rather than "In NaN days"', () => {
    // Every comparison against NaN is false, so the old ladder declined at all six guards
    // and fell to an unconditional final `return`, rendering "In NaN days".
    expect(interviewCountdown('not-a-date', at(2026, 9, 7, 12))).toBeNull();
  });

  it('returns null for an empty string and for undefined', () => {
    expect(interviewCountdown('', at(2026, 9, 7, 12))).toBeNull();
    expect(interviewCountdown(undefined, at(2026, 9, 7, 12))).toBeNull();
  });

  it('treats a long-past epoch-0 date as completed rather than missing', () => {
    // 1970-01-01T00:00:00Z is a real instant whose getTime() is 0. It must render as a past
    // interview, not vanish.
    const result = interviewCountdown('1970-01-01T00:00:00.000Z', at(2026, 9, 7, 12));
    expect(result).toEqual({ text: 'Interview completed', urgency: 'past' });
  });

  it('still speaks when the interview is starting at this exact instant', () => {
    // This is the assertion that pins the guard as `Number.isNaN(diffMs)` rather than a
    // truthiness test on `diffMs`. The two differ on exactly one input — `diffMs === 0` — and
    // the epoch-0 case above does NOT reach it, because there the *date* is zero while the
    // *difference* is a large negative number. Rewriting the guard as `if (!diffMs)` survived
    // every other test in this file: it blanks the card at the one moment the countdown is
    // most load-bearing, when the interview is starting right now.
    const now = at(2026, 9, 7, 12);
    expect(interviewCountdown(now.toISOString(), now)).toEqual({
      text: 'In 0 minutes',
      urgency: 'critical',
    });
  });
});

describe('interviewCountdown — the sub-day rungs stay elapsed-time', () => {
  it('reports minutes under two hours', () => {
    expect(interviewCountdown(at(2026, 9, 7, 13, 30).toISOString(), at(2026, 9, 7, 12))).toEqual({
      text: 'In 90 minutes',
      urgency: 'critical',
    });
  });

  it('reports hours from two hours up to a day', () => {
    expect(interviewCountdown(at(2026, 9, 7, 18).toISOString(), at(2026, 9, 7, 12))).toEqual({
      text: 'In 6 hours',
      urgency: 'high',
    });
  });

  it('prefers hours over "Tomorrow" for an early interview tomorrow', () => {
    // 23:00 tonight -> 09:00 tomorrow crosses a date boundary, but "In 10 hours" is the more
    // useful answer and the hours rung deliberately runs first.
    expect(interviewCountdown(at(2026, 9, 8, 9).toISOString(), at(2026, 9, 7, 23))).toEqual({
      text: 'In 10 hours',
      urgency: 'high',
    });
  });

  it('reports a past interview as completed', () => {
    expect(interviewCountdown(at(2026, 9, 6, 9).toISOString(), at(2026, 9, 7, 12))).toEqual({
      text: 'Interview completed',
      urgency: 'past',
    });
  });
});

describe('interviewCountdown — urgency tiers past two days', () => {
  it('uses "low" within a week and "neutral" beyond it', () => {
    const now = at(2026, 9, 7, 12);
    expect(interviewCountdown(at(2026, 9, 12, 12).toISOString(), now)).toEqual({
      text: 'In 5 days',
      urgency: 'low',
    });
    expect(interviewCountdown(at(2026, 9, 14, 12).toISOString(), now)).toEqual({
      text: 'In 7 days',
      urgency: 'low',
    });
    expect(interviewCountdown(at(2026, 9, 15, 12).toISOString(), now)).toEqual({
      text: 'In 8 days',
      urgency: 'neutral',
    });
  });

  it('keeps the page-level test’s 72-hour case at "In 3 days"', () => {
    // The pre-existing assertion in InterviewPrepPage.interviewDate.test.tsx. Old and new
    // arithmetic agree here, which is exactly why that test never reddened on the defect;
    // restating it locally documents that the fix is not a behaviour change at this offset.
    process.env.TZ = 'America/New_York';
    const result = interviewCountdown(
      '2026-09-10T02:30:00.000Z',
      new Date('2026-09-07T02:30:00.000Z')
    );
    expect(result?.text).toBe('In 3 days');
  });
});

describe('calendarDaysBetween', () => {
  it('counts date boundaries crossed, not 24-hour blocks', () => {
    expect(calendarDaysBetween(at(2026, 9, 7, 23), at(2026, 9, 8, 1))).toBe(1);
    expect(calendarDaysBetween(at(2026, 9, 7, 1), at(2026, 9, 7, 23))).toBe(0);
  });

  it('counts a DST-shortened local day as one day', () => {
    // Europe/London springs forward 2026-03-29, making that local day 23 hours long. A raw
    // millisecond subtraction with a floor would score it 0; midnight-normalising and
    // rounding scores it 1.
    process.env.TZ = 'Europe/London';
    expect(calendarDaysBetween(at(2026, 3, 29, 12), at(2026, 3, 30, 12))).toBe(1);
    expect(calendarDaysBetween(at(2026, 3, 28, 12), at(2026, 3, 30, 12))).toBe(2);
  });

  it('is negative for a date in the past', () => {
    expect(calendarDaysBetween(at(2026, 9, 9, 12), at(2026, 9, 7, 12))).toBe(-2);
  });
});
