import { describe, it, expect, afterEach } from 'vitest';
import { interviewCountdown, calendarDaysBetween } from './interviewCountdown';

/**
 * Every rung of the countdown ladder, addressed directly.
 *
 * `InterviewPrepPage.interviewDate.test.tsx` pins the countdown through the page, at exactly
 * 72 hours out. That is the single offset where the old `Math.ceil(diffMs / DAY_MS)` and the
 * calendar arithmetic that replaced it return the same answer, so the page test stayed green
 * across the whole defect and could not have caught it. These tests exist because a ladder
 * with seven rungs needs seven assertions, not one.
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

  it('does not confuse a valid epoch-0 date with a missing one', () => {
    // The guard is `Number.isNaN`, not truthiness of the timestamp: 1970-01-01T00:00:00Z is a
    // real instant whose getTime() is 0, and it must render as a past interview, not vanish.
    const result = interviewCountdown('1970-01-01T00:00:00.000Z', at(2026, 9, 7, 12));
    expect(result).toEqual({ text: 'Interview completed', urgency: 'past' });
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
