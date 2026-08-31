import { describe, expect, it } from 'vitest';

import {
  applicationFilterDate,
  filterByDateRange,
  isEmptyDateRange,
  isWithinDateRange,
  type DateRangeFilter,
} from './dateRangeFilter';

/**
 * WIC-1613 — the two decisions US-6.3 left open, pinned.
 *
 * Every `Date` below is built with the local-time constructor (`new Date(y, m, d, …)`)
 * rather than an ISO string. A bound is a calendar day the user picked in their own
 * timezone, so a fixture written as `'2026-03-15T00:00:00Z'` would land on 14 March
 * anywhere west of UTC and these assertions would flip on the runner's `TZ` rather than
 * on the code. `new Date(2026, 2, 15)` is 15 March locally, everywhere.
 *
 * Note `new Date`'s month is 0-based: month `2` is March.
 */

const MAR_01 = new Date(2026, 2, 1, 9, 0);
const MAR_15 = new Date(2026, 2, 15, 9, 0);
const MAR_31_LATE = new Date(2026, 2, 31, 23, 59, 59);
const APR_01_EARLY = new Date(2026, 3, 1, 0, 0, 1);
const FEB_28_LATE = new Date(2026, 1, 28, 23, 59, 59);

/** A row is only ever read for its two dates, so that is all a fixture needs to carry. */
function row(createdAt: Date, appliedAt?: Date) {
  return { createdAt, appliedAt };
}

describe('applicationFilterDate — WHICH date US-6.3 filters on (WIC-1613)', () => {
  it('uses appliedAt when the user has applied', () => {
    expect(applicationFilterDate(row(MAR_01, MAR_15))).toEqual(MAR_15);
  });

  it('falls back to createdAt for a row that was only ever saved', () => {
    // The `saved` status has no `appliedAt` at all. Without this fallback a date filter
    // would silently drop every saved row, contradicting the same AC row's "dashboard
    // showing ALL my applications".
    expect(applicationFilterDate(row(MAR_01))).toEqual(MAR_01);
  });

  it('prefers appliedAt over createdAt even when they disagree by weeks', () => {
    // The distinguishing case: if this returned `createdAt` the two tests above would
    // both still pass whenever a fixture happened to set them equal.
    const resolved = applicationFilterDate(row(new Date(2026, 0, 5), new Date(2026, 5, 20)));
    expect(resolved).toEqual(new Date(2026, 5, 20));
    expect(resolved).not.toEqual(new Date(2026, 0, 5));
  });
});

describe('isWithinDateRange — inclusive local-day bounds (WIC-1613)', () => {
  const MARCH: DateRangeFilter = { start: '2026-03-01', end: '2026-03-31' };

  it('includes a row inside the window', () => {
    expect(isWithinDateRange(row(MAR_15), MARCH)).toBe(true);
  });

  it('excludes a row after the window', () => {
    expect(isWithinDateRange(row(APR_01_EARLY), MARCH)).toBe(false);
  });

  it('excludes a row before the window', () => {
    expect(isWithinDateRange(row(FEB_28_LATE), MARCH)).toBe(false);
  });

  it('includes the last instant of the end day, not just its midnight', () => {
    // The bug this exists for: comparing against `parseISO(end)` rather than
    // `endOfDay(end)` silently excludes all but the first millisecond of the day the
    // user picked, so "1–31 March" loses almost everything dated the 31st.
    expect(isWithinDateRange(row(MAR_31_LATE), MARCH)).toBe(true);
  });

  it('includes the first instant of the start day', () => {
    expect(isWithinDateRange(row(new Date(2026, 2, 1, 0, 0, 0)), MARCH)).toBe(true);
  });

  it('filters on appliedAt, so a row created outside the window but applied inside is kept', () => {
    // Both halves matter, and each is the other's control: the same row, one field
    // apart, must land on opposite sides.
    expect(isWithinDateRange(row(new Date(2026, 0, 10), MAR_15), MARCH)).toBe(true);
    expect(isWithinDateRange(row(MAR_15, new Date(2026, 0, 10)), MARCH)).toBe(false);
  });

  it('applies a start-only range as an open-ended "everything since"', () => {
    const since: DateRangeFilter = { start: '2026-03-01' };
    expect(isWithinDateRange(row(FEB_28_LATE), since)).toBe(false);
    expect(isWithinDateRange(row(MAR_15), since)).toBe(true);
    expect(isWithinDateRange(row(APR_01_EARLY), since)).toBe(true);
  });

  it('applies an end-only range as an open-ended "everything up to"', () => {
    const until: DateRangeFilter = { end: '2026-03-31' };
    expect(isWithinDateRange(row(FEB_28_LATE), until)).toBe(true);
    expect(isWithinDateRange(row(MAR_15), until)).toBe(true);
    expect(isWithinDateRange(row(APR_01_EARLY), until)).toBe(false);
  });

  it('keeps every row when no bound is set', () => {
    for (const empty of [undefined, {}, { start: '' }, { start: '', end: '' }]) {
      expect(isWithinDateRange(row(MAR_15), empty)).toBe(true);
      expect(isWithinDateRange(row(APR_01_EARLY), empty)).toBe(true);
    }
  });

  it('matches nothing when the range is inverted, rather than quietly ignoring an end', () => {
    expect(isWithinDateRange(row(MAR_15), { start: '2026-03-31', end: '2026-03-01' })).toBe(false);
  });

  it('excludes a row whose date cannot be resolved while a range is active', () => {
    // Stated rather than inherited from `NaN` comparing false against both bounds: the
    // user asked for a window, and a row with no knowable date is not demonstrably in
    // it. `createdAt` is required on `Application`, so this is unreachable through the
    // real service — which is exactly why it needs pinning rather than assuming.
    const undated = { createdAt: undefined as unknown as Date, appliedAt: undefined };
    expect(applicationFilterDate(undated)).toBeNull();
    expect(isWithinDateRange(undated, MARCH)).toBe(false);
    // ...but an inactive range still cannot remove it.
    expect(isWithinDateRange(undated, {})).toBe(true);
  });

  it('ignores a bound it cannot parse instead of emptying the list', () => {
    // A saved shortcut in `localStorage` can carry anything an older build wrote;
    // `SavedFilterShortcuts` does not validate on the way back in. Showing every row is
    // a visible no-op, showing none is indistinguishable from data loss.
    const junk = { start: 'last tuesday', end: '2026-03-31' } as DateRangeFilter;
    expect(isWithinDateRange(row(FEB_28_LATE), junk)).toBe(true);
    // The readable half is still enforced — this is not a blanket bail-out.
    expect(isWithinDateRange(row(APR_01_EARLY), junk)).toBe(false);
  });
});

describe('reading a bound is self-checking, not a pattern match (WIC-1613)', () => {
  /**
   * `isEmptyDateRange` is the observable for `readBound`: a bound that reads as a day
   * makes the range non-empty, one that does not is ignored. Each case below is chosen
   * because it separates the round-trip guard from a plausible weaker one — a regex.
   *
   * The first draft here *was* a regex, `/^\d{4}-\d{2}-\d{2}$/`. Deleting its anchors
   * changed no test result, which is the whole reason this block exists: a guard whose
   * removal is invisible was never guarding.
   */
  const READS_AS_A_DAY = [
    ['a bare calendar day, what the control emits', '2026-03-01'],
    ['surrounding whitespace', '  2026-03-01  '],
    // What `JSON.stringify` makes of a `Date` — the shape a shortcut saved against the
    // old `{ start: Date; end: Date }` type would carry.
    ['a full ISO timestamp, reduced to its date part', '2026-03-01T00:00:00.000Z'],
    // The documented limit of the guard, pinned so the comment on `readBound` is
    // checkable rather than prose (WIC-1613 review, note 3). Only the first ten
    // characters round-trip; past them this is a `T`-separator check and NOT a time
    // parser, so these read as 1 Mar 2026 rather than being rejected. That is the
    // intended fail-soft for a corrupt `localStorage` bound — the time is discarded
    // either way, so the day is still right. Contrast `'2026-03-01x'` below, which has
    // no `T` and IS rejected: that pair is the whole boundary.
    ['a bare `T` separator with no time after it', '2026-03-01T'],
    ['junk behind a `T`, which the guard does not inspect', '2026-03-01Thursday'],
  ] as const;

  const READS_AS_NOTHING = [
    // A regex accepts both of these; there is no such day in either case.
    ['an impossible month and day', '2026-13-45'],
    ['a day that does not exist in that month', '2026-02-30'],
    // These separate the round trip from an UNANCHORED regex: each contains a
    // well-formed date, and an unanchored `\d{4}-\d{2}-\d{2}` matches every one.
    ['prose that merely contains a date', 'on 2026-03-01 please'],
    ['trailing junk behind ten valid-looking characters', '2026-03-01x'],
    ['leading junk', 'x2026-03-01'],
    // Wrong shape rather than wrong value.
    ['an unpadded day', '2026-3-1'],
    ['a basic-format day', '20260301'],
    ['free text', 'last tuesday'],
    ['the empty string the control emits when cleared', ''],
  ] as const;

  it.each(READS_AS_A_DAY)('reads %s', (_label, bound) => {
    expect(isEmptyDateRange({ start: bound })).toBe(false);
  });

  it.each(READS_AS_NOTHING)('ignores %s', (_label, bound) => {
    expect(isEmptyDateRange({ start: bound })).toBe(true);
  });

  it('reads an ISO timestamp as the LOCAL day it names, not as a UTC instant', () => {
    // `parseISO('2026-03-01T00:00:00Z')` is an instant, and west of UTC that instant is
    // 28 February locally — so honouring the timestamp directly would shift the window
    // by a day for half the world. Taking the date part keeps every bound on the same
    // local-calendar footing.
    const fromTimestamp = { start: '2026-03-01T00:00:00.000Z', end: '2026-03-31T23:59:59.999Z' };
    const fromDays = { start: '2026-03-01', end: '2026-03-31' };

    for (const candidate of [MAR_01, MAR_15, MAR_31_LATE, FEB_28_LATE, APR_01_EARLY]) {
      expect(isWithinDateRange(row(candidate), fromTimestamp)).toBe(
        isWithinDateRange(row(candidate), fromDays)
      );
    }
    // ...and that agreement is not two filters both matching everything.
    expect(isWithinDateRange(row(MAR_15), fromTimestamp)).toBe(true);
    expect(isWithinDateRange(row(APR_01_EARLY), fromTimestamp)).toBe(false);
  });
});

describe('isEmptyDateRange (WIC-1613)', () => {
  it('is true only when neither end is a readable day', () => {
    expect(isEmptyDateRange(undefined)).toBe(true);
    expect(isEmptyDateRange({})).toBe(true);
    expect(isEmptyDateRange({ start: '', end: '' })).toBe(true);
    expect(isEmptyDateRange({ start: 'nonsense' } as DateRangeFilter)).toBe(true);

    expect(isEmptyDateRange({ start: '2026-03-01' })).toBe(false);
    expect(isEmptyDateRange({ end: '2026-03-31' })).toBe(false);
  });
});

describe('filterByDateRange (WIC-1613)', () => {
  const rows = [
    { id: 'before', ...row(FEB_28_LATE) },
    { id: 'inside', ...row(MAR_15) },
    { id: 'inside-by-appliedAt', ...row(new Date(2026, 0, 10), MAR_15) },
    { id: 'after', ...row(APR_01_EARLY) },
  ];

  it('keeps exactly the rows inside the window', () => {
    const kept = filterByDateRange(rows, { start: '2026-03-01', end: '2026-03-31' });
    expect(kept.map((r) => r.id)).toEqual(['inside', 'inside-by-appliedAt']);
  });

  it('returns the same array identity for an empty range, so the page memo does no work', () => {
    expect(filterByDateRange(rows, undefined)).toBe(rows);
    expect(filterByDateRange(rows, {})).toBe(rows);
  });

  it('can return nothing, and does not fall open to the full list when it does', () => {
    // The fail-open shape this guards against: a filter that returns everything when it
    // matches nothing looks identical to one the user never applied.
    expect(filterByDateRange(rows, { start: '2030-01-01' })).toEqual([]);
  });
});
