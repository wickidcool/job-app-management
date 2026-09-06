/**
 * `<input type="datetime-local">` ⇄ ISO-8601-instant conversion.
 *
 * WIC-2188. This exists for `applications.interviewDate`, and it is a module rather than
 * two inline expressions because both directions have a wrong-looking-right implementation
 * that a reader would reach for first.
 *
 * **Outbound.** A `datetime-local` control's value is `YYYY-MM-DDTHH:mm` (seconds optional)
 * in the *user's* zone, with no offset on it at all. The API validates the field as
 * `z.string().datetime({ offset: true })` (`packages/api/src/routes/applications.ts`), so
 * that raw value is rejected — and a bare `<input type="date">`, which is what the sibling
 * `nextActionDue` field uses, is rejected too. The column is `TIMESTAMPTZ` and the service
 * feeds the string straight to `new Date(...)`, so the wire format has to be a full instant.
 *
 * **Inbound.** The DTO hands back a full ISO string in UTC. Slicing the first sixteen
 * characters off it produces something `datetime-local` will happily display, and it shows
 * the *UTC* wall clock — the wrong hour for anyone not on UTC, and the wrong day for anyone
 * far enough east or west. The instant has to be rendered through the local zone instead.
 *
 * The asymmetry between the two date fields on the same form is the whole hazard here, so
 * neither direction is inlined at a call site where it would read as boilerplate.
 */

/**
 * The shape an `<input type="datetime-local">` produces. Seconds are optional — a control
 * with a `step` finer than a minute emits them — but a *time* is not.
 *
 * Requiring the time component is the load-bearing part. `new Date('2026-09-10')` is a
 * perfectly valid `Date`; the spec reads a date-only string as UTC midnight and a
 * date-and-time string with no offset as local. So a date-only value does not fail
 * conversion, it succeeds at the wrong instant — shifted by the user's offset, which for
 * anyone west of Greenwich lands on the previous day. This pattern is what stops that
 * string from ever reaching the conversion.
 */
export const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/** True when `value` has the shape `<input type="datetime-local">` emits. */
export function isDateTimeLocalValue(value: string): boolean {
  return DATETIME_LOCAL_PATTERN.test(value);
}

/**
 * Convert a `datetime-local` control value to an ISO-8601 instant with an offset, ready for
 * the wire. Returns `null` — never a shifted instant — when `value` is not a local
 * date-and-time, or is one `Date` refuses outright (`2026-13-01T10:00`, `2026-09-10T25:00`).
 *
 * Stated honestly, because the `null` branch is narrower than it looks: V8 **rolls over** a
 * day that overflows its month rather than rejecting it, so `2026-02-30T10:00` converts
 * successfully to 2 March. That is not something this function can distinguish, and it is
 * not worth hand-rolling a calendar to catch — a real `datetime-local` control cannot emit
 * it, and the field is optional. Measured, not assumed; `datetimeLocal.test.ts` pins it so
 * the next reader does not have to re-run the probe.
 *
 * The returned string ends in `Z`, which satisfies `datetime({ offset: true })`: that option
 * *adds* `±HH:mm` to the `Z` zod already accepts, it does not replace it.
 */
export function dateTimeLocalToInstant(value: string): string | null {
  if (!isDateTimeLocalValue(value)) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

/**
 * Render an ISO-8601 instant as the `YYYY-MM-DDTHH:mm` a `datetime-local` control needs,
 * **in the local zone**. Returns `''` for an absent or unparseable value, which is the
 * empty-control state the form already uses for every other optional field.
 *
 * Built from the local getters rather than by slicing `toISOString()`, because the latter
 * would display the UTC wall clock. Round-tripping that back through
 * `dateTimeLocalToInstant` would then re-read those digits as local and move the stored
 * instant every time the user saved the form without touching this field.
 */
export function instantToDateTimeLocal(iso: string | undefined | null): string {
  if (!iso) return '';

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}
