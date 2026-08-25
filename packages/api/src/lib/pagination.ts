import { AppError } from '../types/index.js';

/**
 * Offset pagination cursors, in one place.
 *
 * The encoder and the decoder used to be copy-pasted, apart, at ten call sites
 * across six services (WIC-1308 fixed one of them; WIC-1312 is the other nine).
 * Living apart is what let them drift: every site could produce a cursor but
 * only one could reject a bad one. Keep them adjacent.
 */

/** The wire form of a cursor: the row offset, base64url-encoded. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

/**
 * Resolves a pagination cursor to a row offset. Absent cursor means the first
 * page; anything `encodeCursor` did not produce is a `400`.
 *
 * There is deliberately no `try`/`catch` here. `Buffer.from(s, 'base64url')`
 * does not throw on invalid input — it drops characters outside the alphabet
 * and decodes whatever is left, down to an empty buffer — so a malformed
 * cursor arrives as a *value*, never an exception. The `catch` this replaces
 * was unreachable, and the bad value it was meant to absorb
 * (`parseInt('', 10)` is `NaN`) flowed straight through to `.offset()`
 * (WIC-1308).
 *
 * The digits test earns its place; `Number.isSafeInteger` alone would not do:
 * - `Number('')` is `0`, so a cursor decoding to nothing (`'!!!!'`) would
 *   silently mean page one — the failure mode being fixed, just quieter.
 * - a negative offset is a safe integer, and reaches Postgres as `OFFSET -5`,
 *   which errors with `OFFSET must not be negative` — a `500` the caller
 *   cannot diagnose from the response.
 * `isSafeInteger` still catches the remaining case: a digit string too large
 * to survive `Number` intact.
 *
 * Rejecting rather than falling back to page one is the deliberate choice, and
 * it holds even for the catalog endpoints, whose encoding
 * `docs/architecture/API_CONTRACTS.md` publishes rather than calling opaque: a
 * hand-crafted cursor that *is* a base64url non-negative offset still works,
 * so the only requests this turns into a `400` are ones no correct client can
 * send. Serving page one instead would both hide the caller's bug and invite
 * an endless pagination loop.
 *
 * @param paramName The query parameter this cursor arrived in, so the message
 *   names something the caller can actually find in their request. Not every
 *   endpoint spells it `cursor` — `GET /api/applications` uses `page`.
 */
export function parseCursor(cursor: string | undefined, paramName = 'cursor'): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
  const offset = /^\d+$/.test(decoded) ? Number(decoded) : NaN;
  if (!Number.isSafeInteger(offset)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Invalid \`${paramName}\`. Pass back the \`next${paramName === 'page' ? 'Page' : 'Cursor'}\` from a previous response verbatim, or omit it for the first page.`,
      undefined,
      400
    );
  }
  return offset;
}
