import { AppError } from '../types/index.js';

/**
 * Offset pagination cursors, in one place.
 *
 * The encoder and the decoder used to be copy-pasted, apart, at twelve call
 * sites across five services — catalog 6, reports 3, application 1,
 * cover-letter 1, resume-variant 1 (WIC-1308 fixed the three in reports;
 * WIC-1312 is the other nine). Living apart is what let them drift: every site
 * could produce a cursor but only one trio could reject a bad one. Keep them
 * adjacent.
 *
 * `test/pagination.test.ts` drives all twelve through this module and counts
 * them, so the tally above is checked rather than asserted (WIC-1335 — the
 * first draft of both this comment and that table was three sites short).
 */

/** The wire form of a cursor: the row offset, base64url-encoded. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

/**
 * What one endpoint calls its cursor on the way in and on the way out. These
 * are two independent facts about a published contract, so neither is derived
 * from the other.
 */
export interface CursorNames {
  /** The query parameter the cursor arrives in. */
  param: string;
  /** The response field that carries the next one back. */
  responseField: string;
}

/** What all but one endpoint use. `GET /api/applications` is the exception. */
export const CURSOR_NAMES: CursorNames = { param: 'cursor', responseField: 'nextCursor' };
export const PAGE_NAMES: CursorNames = { param: 'page', responseField: 'nextPage' };

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
 * Rejecting rather than falling back to page one is the deliberate choice.
 * Cursors are opaque and server-issued on every list endpoint, and
 * `docs/architecture/API_CONTRACTS.md` § Pagination says so outright — "a
 * cursor this API did not issue is not a supported input: it may return an
 * error rather than a page of results" — so the only requests this turns into
 * a `400` are ones no correct client can send. Serving page one instead would
 * both hide the caller's bug and invite an endless pagination loop.
 *
 * This paragraph used to argue the other way round: the catalog `Diffs` row
 * published the encoding, so a hand-crafted base64url offset counted as a
 * legitimate input that still works. PR #120 (`172802b`) deleted that row's
 * encoding, which strengthens the conclusion rather than weakening it — a
 * hand-crafted cursor is now not a supported input at all (WIC-1567). The
 * claim above deliberately rests on § Pagination's blanket statement rather
 * than on a count of parameter rows: the row count tracks how many endpoints
 * are documented and moves whenever one is added.
 *
 * @param names What this endpoint calls its cursor, so the message points at
 *   something the caller can actually find. Both halves are stated because
 *   neither implies the other: `GET /api/applications` reads `page` and
 *   answers `nextPage`, everything else reads `cursor` and answers
 *   `nextCursor`, but an endpoint is free to pair them however it likes
 *   (WIC-1335).
 */
export function parseCursor(cursor: string | undefined, names: CursorNames = CURSOR_NAMES): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
  const offset = /^\d+$/.test(decoded) ? Number(decoded) : NaN;
  if (!Number.isSafeInteger(offset)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Invalid \`${names.param}\`. Pass back the \`${names.responseField}\` from a previous response verbatim, or omit it for the first page.`,
      undefined,
      400
    );
  }
  return offset;
}
