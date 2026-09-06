import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DATETIME_LOCAL_PATTERN,
  dateTimeLocalToInstant,
  instantToDateTimeLocal,
  isDateTimeLocalValue,
} from './datetimeLocal';

/**
 * WIC-2188 — `<input type="datetime-local">` ⇄ ISO-instant conversion for
 * `applications.interviewDate`.
 *
 * ## Why this file pins `process.env.TZ` rather than asserting round-trips only
 *
 * Both defects this module exists to prevent are *offset* defects: a date-only string read
 * as UTC midnight on the way out, and a UTC wall clock displayed as a local one on the way
 * back. **Neither is observable in UTC** — the shift is exactly zero — and this repo pins no
 * timezone anywhere (no `TZ` in `vitest.config.ts`, none in `src/test/setup.ts`), so the box
 * these run on is UTC and a naive assertion would be green on a broken implementation.
 *
 * A pure round-trip assertion has the same hole from the other side: `slice(0, 16)` of an ISO
 * string round-trips through a `new Date(local)` that re-reads those same digits as local, so
 * "in equals out" is satisfied by the wrong-hour implementation too. It is a necessary check,
 * not a sufficient one, and it is here as one case among several rather than as the whole test.
 *
 * So the zone is set explicitly, to a zone with a *non-zero, non-integer-friendly* offset, and
 * the expected instants are written out as literals. Node re-reads `process.env.TZ` for each
 * `Date` operation, which is what makes this possible in-process; `beforeEach`/`afterEach`
 * restore the ambient value so no other suite inherits it.
 *
 * `America/New_York` on 10 September is EDT, UTC−4. `2026-09-10T14:30` local is therefore
 * `18:30Z`, not the `19:30Z` the card's worked example quotes (that figure is EST, the
 * winter offset). The literals below are the measured values.
 */

const AMBIENT_TZ = process.env.TZ;

function withTimeZone(tz: string) {
  process.env.TZ = tz;
}

beforeEach(() => {
  // Establish a known non-UTC zone for every case. Individual cases override it.
  withTimeZone('America/New_York');
});

afterEach(() => {
  if (AMBIENT_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = AMBIENT_TZ;
});

describe('DATETIME_LOCAL_PATTERN / isDateTimeLocalValue', () => {
  it('accepts what a datetime-local control emits, with and without seconds', () => {
    expect(isDateTimeLocalValue('2026-09-10T14:30')).toBe(true);
    expect(isDateTimeLocalValue('2026-09-10T14:30:00')).toBe(true);
  });

  it('rejects a date alone — the regex `nextActionDue` uses would accept it', () => {
    // This is the whole reason the pattern requires a `T` and a time. Kept as an explicit
    // case so a future widening of the pattern fails here and not only in the form suite.
    expect(isDateTimeLocalValue('2026-09-10')).toBe(false);
    expect(/^\d{4}-\d{2}-\d{2}$/.test('2026-09-10')).toBe(true);
  });

  it('rejects a value that already carries an offset', () => {
    // A full instant is what this module *produces*; feeding one back in as if it were a
    // control value is how the inbound direction gets skipped, so it must not silently pass.
    expect(isDateTimeLocalValue('2026-09-10T18:30:00.000Z')).toBe(false);
    expect(isDateTimeLocalValue('2026-09-10T14:30-04:00')).toBe(false);
  });

  it('is anchored at both ends', () => {
    expect(DATETIME_LOCAL_PATTERN.test('x2026-09-10T14:30')).toBe(false);
    expect(DATETIME_LOCAL_PATTERN.test('2026-09-10T14:30x')).toBe(false);
  });
});

describe('dateTimeLocalToInstant', () => {
  it('reads the control value in the local zone and emits an instant with an offset', () => {
    withTimeZone('America/New_York');
    expect(dateTimeLocalToInstant('2026-09-10T14:30')).toBe('2026-09-10T18:30:00.000Z');
  });

  it('produces a different instant for the same wall clock in a different zone', () => {
    // The negative control for the case above. Without it, an implementation that ignored
    // the zone entirely and pasted `:00.000Z` onto the input would still have to be caught
    // by inspection; here it fails, because these two lines cannot both hold for it.
    withTimeZone('Asia/Tokyo');
    expect(dateTimeLocalToInstant('2026-09-10T14:30')).toBe('2026-09-10T05:30:00.000Z');
  });

  it('emits a `Z` suffix, which is what satisfies the API `datetime({ offset: true })` rule', () => {
    withTimeZone('America/New_York');
    const instant = dateTimeLocalToInstant('2026-09-10T14:30');
    expect(instant).toMatch(/Z$/);
    // Same shape zod's `.datetime()` accepts: seconds are mandatory there, fractional
    // seconds optional. `toISOString()` always supplies both.
    expect(instant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('REFUSES a date-only string rather than reading it as UTC midnight', () => {
    // The regression the API's WIC-2023 comment warns about, asserted at the layer that can
    // still stop it. `new Date('2026-09-10')` is a valid Date — the second assertion proves
    // the trap is live in this runtime, so the first one is not guarding a phantom.
    withTimeZone('America/New_York');
    expect(dateTimeLocalToInstant('2026-09-10')).toBeNull();
    expect(new Date('2026-09-10').toISOString()).toBe('2026-09-10T00:00:00.000Z');
    // ...which in the user's zone is 8pm on the 9th. A whole day out.
    expect(new Date('2026-09-10').getDate()).toBe(9);
  });

  it('returns null for a date `Date` refuses outright', () => {
    expect(dateTimeLocalToInstant('2026-13-01T10:00')).toBeNull();
    expect(dateTimeLocalToInstant('2026-09-10T25:00')).toBeNull();
    expect(dateTimeLocalToInstant('2026-09-10T14:60')).toBeNull();
  });

  it('does NOT catch a day that overflows its month — V8 rolls it over (measured)', () => {
    // Documented rather than fixed, and pinned so the docstring cannot drift from reality.
    // A real control cannot emit this; hand-rolling a calendar to reject it would be a
    // second implementation of the parser for no reachable user.
    withTimeZone('America/New_York');
    expect(dateTimeLocalToInstant('2026-02-30T10:00')).toBe('2026-03-02T15:00:00.000Z');
  });

  it('returns null for an empty string', () => {
    expect(dateTimeLocalToInstant('')).toBeNull();
  });
});

describe('instantToDateTimeLocal', () => {
  it('renders a stored instant as the LOCAL wall clock, not the UTC one', () => {
    // The inbound half of the defect. `'2026-09-10T18:30:00.000Z'.slice(0, 16)` is
    // `'2026-09-10T18:30'` — a value the control displays quite happily, and the wrong hour.
    withTimeZone('America/New_York');
    expect(instantToDateTimeLocal('2026-09-10T18:30:00.000Z')).toBe('2026-09-10T14:30');
    expect('2026-09-10T18:30:00.000Z'.slice(0, 16)).toBe('2026-09-10T18:30');
  });

  it('crosses the date line where the offset demands it', () => {
    // Not the same day in both zones. A slice implementation gets the date wrong here, not
    // merely the hour, which is the case worth having as its own assertion.
    withTimeZone('Asia/Tokyo');
    expect(instantToDateTimeLocal('2026-09-10T18:30:00.000Z')).toBe('2026-09-11T03:30');
  });

  it('zero-pads every component', () => {
    withTimeZone('UTC');
    expect(instantToDateTimeLocal('2026-01-02T03:04:00.000Z')).toBe('2026-01-02T03:04');
  });

  it('returns the empty-control value for absent or unparseable input', () => {
    expect(instantToDateTimeLocal(undefined)).toBe('');
    expect(instantToDateTimeLocal(null)).toBe('');
    expect(instantToDateTimeLocal('')).toBe('');
    expect(instantToDateTimeLocal('not a date')).toBe('');
  });
});

describe('round trip', () => {
  it('local -> instant -> local is the identity in a non-UTC zone', () => {
    // Necessary but NOT sufficient on its own — the slice implementation also satisfies it,
    // which is why the literal-valued cases above exist. It is here to catch the drift the
    // literals cannot: a change to one direction only.
    withTimeZone('America/New_York');
    const local = '2026-09-10T14:30';
    expect(instantToDateTimeLocal(dateTimeLocalToInstant(local)!)).toBe(local);
  });

  it('survives a DST boundary in both directions', () => {
    // US DST ends 2026-11-01. An instant on either side must come back as the wall clock a
    // user in that zone would actually read, with the offset that applied *then* rather than
    // the one applying now.
    withTimeZone('America/New_York');
    expect(dateTimeLocalToInstant('2026-10-31T14:30')).toBe('2026-10-31T18:30:00.000Z'); // EDT, -4
    expect(dateTimeLocalToInstant('2026-11-02T14:30')).toBe('2026-11-02T19:30:00.000Z'); // EST, -5
    expect(instantToDateTimeLocal('2026-10-31T18:30:00.000Z')).toBe('2026-10-31T14:30');
    expect(instantToDateTimeLocal('2026-11-02T19:30:00.000Z')).toBe('2026-11-02T14:30');
  });
});
