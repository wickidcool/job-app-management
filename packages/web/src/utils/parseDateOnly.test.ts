import { describe, it, expect, afterEach } from 'vitest';
import { format } from 'date-fns';
import { parseDateOnly } from './parseDateOnly';
import { calendarDaysBetween } from './interviewCountdown';

/**
 * WIC-2267. Every assertion here is pinned to a **non-UTC** zone on purpose.
 *
 * The defect this file guards is invisible under UTC — `new Date('2026-09-10')` and local
 * midnight coincide there — so a suite that asserted under the runner's default zone would
 * pass against the broken code and prove nothing. Each `describe` sets `process.env.TZ`
 * before constructing any `Date`, following `interviewCountdown.test.ts`.
 *
 * `utcControl` below is the guard on the guard: it pins that these same inputs are clean in
 * UTC. If that test ever fails, the harness is wrong rather than the code.
 */
const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

describe('parseDateOnly', () => {
  it('reads a date-only string as the LOCAL wall date, not UTC midnight', () => {
    process.env.TZ = 'America/New_York';
    const parsed = parseDateOnly('2026-01-01');

    // The whole defect in one assertion: `new Date('2026-01-01')` is 2025-12-31T19:00 here.
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(0);
    expect(parsed!.getDate()).toBe(1);
    expect(parsed!.getHours()).toBe(0);
    expect(format(parsed!, 'MMM d, yyyy')).toBe('Jan 1, 2026');
  });

  it('does not shift the year boundary in a far-negative zone', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(format(parseDateOnly('2026-01-01')!, 'MMM d, yyyy')).toBe('Jan 1, 2026');
  });

  it('is stable in a positive-offset zone too', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(format(parseDateOnly('2026-01-01')!, 'MMM d, yyyy')).toBe('Jan 1, 2026');
  });

  it('lands on local midnight across a spring-forward transition', () => {
    // America/New_York springs forward on 2026-03-08; that local day starts at 00:00 EST.
    process.env.TZ = 'America/New_York';
    const parsed = parseDateOnly('2026-03-08')!;
    expect(parsed.getDate()).toBe(8);
    expect(parsed.getHours()).toBe(0);
  });

  it('returns null rather than a wrong date for input it cannot honour', () => {
    process.env.TZ = 'America/New_York';
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(parseDateOnly('')).toBeNull();
    // Not date-only: this is the `interviewDate` shape, which must not come through here.
    expect(parseDateOnly('2026-09-10T14:30:00Z')).toBeNull();
    expect(parseDateOnly('09/10/2026')).toBeNull();
    expect(parseDateOnly('2026-9-10')).toBeNull();
    // Overflow the raw `Date` constructor would absorb: `new Date(2026, 1, 30)` is 2 March.
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
    // Years 0-99 map into 1900-1999 in the `Date` constructor, so the year guard rejects
    // them rather than silently returning 1926. No due date is in the first century; a
    // refusal is the safe direction and keeps the guard one-directional.
    expect(parseDateOnly('0026-01-01')).toBeNull();
  });

  it('utcControl: the same inputs are clean under UTC', () => {
    process.env.TZ = 'UTC';
    expect(format(parseDateOnly('2026-01-01')!, 'MMM d, yyyy')).toBe('Jan 1, 2026');
  });
});

/**
 * The four call sites, exercised as the pages compute them. These are the assertions that
 * fail against `d06ef95e` — the helper alone could be correct while a caller still used the
 * old parse, so each badge/label is pinned through the real arithmetic.
 */
describe('due-date arithmetic at the call sites (TZ-pinned)', () => {
  const daysUntilDue = (s: string, now: Date) => {
    const due = parseDateOnly(s);
    return due === null ? null : calendarDaysBetween(now, due);
  };

  it('a row due TODAY is not overdue, and is due-today in the aggregate', () => {
    process.env.TZ = 'America/New_York';
    // 09:00 local, well after the UTC-midnight instant the old code compared against.
    const now = new Date(2026, 8, 10, 9, 0, 0);
    const days = daysUntilDue('2026-09-10', now);

    expect(days).toBe(0);
    expect(days! < 0).toBe(false); // isOverdue — was `true` before the fix
  });

  it('a row due TOMORROW counts as due-soon, not due-today', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 8, 10, 9, 0, 0);
    expect(daysUntilDue('2026-09-11', now)).toBe(1);
  });

  it('a row due in exactly 3 days IS due-soon in a positive-offset zone', () => {
    // The `<= 3` boundary behaved as `<= 2` in Europe/Berlin before the fix.
    process.env.TZ = 'Europe/Berlin';
    const now = new Date(2026, 8, 10, 9, 0, 0);
    const days = daysUntilDue('2026-09-13', now);

    expect(days).toBe(3);
    expect(days! <= 3).toBe(true); // isDueSoon — was `false` before the fix
  });

  it('a genuinely overdue row is still overdue', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 8, 10, 9, 0, 0);
    expect(daysUntilDue('2026-09-09', now)).toBe(-1);
  });

  it('holds at 23:59 local, the minute most exposed to a UTC-midnight parse', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 8, 10, 23, 59, 0);
    expect(daysUntilDue('2026-09-10', now)).toBe(0);
  });

  /**
   * The two DST intervals, which are the only reason `calendarDaysBetween` rounds at all.
   *
   * These must START on the transition day, not end on it. America/New_York falls back at
   * 02:00 on 2026-11-01, so it is the local day *Nov 1* that is 25 hours long — the interval
   * Oct 31 -> Nov 1 is an ordinary 24 hours and its quotient is exactly 1.0000, which floor,
   * ceil and round all agree on. An earlier revision of this file used that interval under
   * this test's name; it could not have failed. Measured quotients: Nov 1 -> Nov 2 = 1.0417,
   * Mar 8 -> Mar 9 = 0.9583. Together they kill a `Math.round -> Math.ceil` mutant and a
   * `Math.round -> Math.floor` mutant respectively, which is what makes the rounding in
   * `calendarDaysBetween` load-bearing rather than decorative.
   */
  it('counts the 25-hour fall-back local day as one day', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 10, 1, 12, 0, 0); // Nov 1, the 25-hour day itself
    expect(daysUntilDue('2026-11-02', now)).toBe(1); // ceil would say 2
  });

  it('counts the 23-hour spring-forward local day as one day', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 2, 8, 12, 0, 0); // Mar 8, the 23-hour day itself
    expect(daysUntilDue('2026-03-09', now)).toBe(1); // floor would say 0
  });

  it('the detail label renders the stored day verbatim across the year boundary', () => {
    process.env.TZ = 'America/New_York';
    // Was "Dec 31, 2025" before the fix — wrong day, month and year.
    expect(format(parseDateOnly('2026-01-01')!, 'MMM d, yyyy')).toBe('Jan 1, 2026');
  });

  it('utcControl: the call-site assertions are clean under UTC', () => {
    process.env.TZ = 'UTC';
    const now = new Date(2026, 8, 10, 9, 0, 0);
    expect(daysUntilDue('2026-09-10', now)).toBe(0);
    expect(daysUntilDue('2026-09-13', now)).toBe(3);
  });
});
