import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeCursor, parseCursor, PAGE_NAMES } from '../src/lib/pagination.js';
import { AppError } from '../src/types/index.js';

// A database handle that fails the test if anything touches it. Every guarded
// call site must reject a malformed cursor *before* it reaches the query
// builder — that is the whole point of rejecting rather than falling back.
const POISON_DB = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(
        `db.${String(prop)} was reached with a malformed cursor — the guard did not run first`
      );
    },
  }
);

vi.mock('../src/db/client.js', () => ({
  getDb: () => POISON_DB,
}));

import * as catalogService from '../src/services/catalog.service.js';
import * as applicationService from '../src/services/application.service.js';
import * as coverLetterService from '../src/services/cover-letter.service.js';
import * as resumeVariantService from '../src/services/resume-variant.service.js';
import * as reportsService from '../src/services/reports.service.js';

const encode = (offset: string) => Buffer.from(offset).toString('base64url');

// WIC-1308. The predecessor of `parseCursor` wrapped its body in a `try`/`catch`
// that could not fire, because `Buffer.from(s, 'base64url')` does not throw on
// invalid input. The intended fallback therefore never happened and `NaN`
// reached `.offset()` in all three paginated reports.
describe('parseCursor', () => {
  it.each([
    ['undefined', undefined],
    ['the empty string', ''],
  ])('treats %s as the first page', (_label, cursor) => {
    expect(parseCursor(cursor)).toBe(0);
  });

  it.each([0, 1, 50, 1_000_000])('round-trips the offset %i this module issued', (offset) => {
    expect(parseCursor(encodeCursor(offset))).toBe(offset);
  });

  it.each([
    // Each of these produced a bad *value* rather than an exception, which is
    // why the `catch` never ran.
    ['not valid base64url at all', 'not-base64!!'],
    // Note there is no `encode('')` case: it *is* the empty string, which the
    // query layer cannot distinguish from an absent `cursor`, so it is the
    // first page by the rule above rather than a rejection.
    ['base64url that decodes to nothing', '!!!!'],
    ['a negative offset — Postgres rejects OFFSET -5 outright', encode('-5')],
    ['a fractional offset', encode('1.5')],
    ['digits with a trailing tail, which parseInt would have accepted', encode('50junk')],
    ['an offset too large to survive Number intact', encode('99999999999999999999')],
    ['exponent notation, which parseInt read as 1', encode('1e9999')],
    ['whitespace around the digits', encode(' 50 ')],
  ])('rejects %s with a 400', (_label, cursor) => {
    expect(() => parseCursor(cursor)).toThrow(AppError);
    try {
      parseCursor(cursor);
      expect.unreachable('parseCursor should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it('never returns a value Postgres would reject as an OFFSET', () => {
    // The guard the old `catch` was standing in for: whatever comes back is a
    // usable offset, not `NaN` and not negative. Drizzle currently drops the
    // OFFSET clause for `NaN` (it is falsy), so today's symptom is a silent
    // wrong page rather than a 500 — but that is an accident of Drizzle's
    // internals, not a contract this module should lean on.
    for (const cursor of [undefined, '', encodeCursor(0), encodeCursor(42)]) {
      const offset = parseCursor(cursor);
      expect(Number.isSafeInteger(offset)).toBe(true);
      expect(offset).toBeGreaterThanOrEqual(0);
    }
  });

  it('names the query parameter the caller actually sent', () => {
    // `GET /api/applications` spells its cursor `page`. A message saying
    // "Invalid cursor" would send that caller looking for a parameter their
    // request does not contain.
    expect(() => parseCursor('!!!!', PAGE_NAMES)).toThrowError(/`page`.*`nextPage`/s);
    expect(() => parseCursor('!!!!')).toThrowError(/`cursor`.*`nextCursor`/s);
  });

  it('does not derive the response field from the parameter name', () => {
    // WIC-1335. The message used to compute the field as
    // `next${param === 'page' ? 'Page' : 'Cursor'}`, so any third spelling
    // would have been told to pass back `nextCursor` — a field its response
    // does not contain. The two names are now given, not inferred.
    expect(() => parseCursor('!!!!', { param: 'after', responseField: 'endCursor' })).toThrowError(
      /`after`.*`endCursor`/s
    );
  });
});

// WIC-1312. The guard above is worthless at a call site that does not call it,
// and nine sites across four services had their own inlined decode. These cases
// are the load-bearing check: each one drives the real service function with a
// malformed cursor and asserts it throws before the database is touched.
// Reverting any single site to `parseInt(Buffer.from(...))` fails its case here
// — the inline version returns `NaN` and walks straight into `POISON_DB`.
//
// WIC-1335. The table must be *exhaustive*, not merely long. It first listed
// only the nine sites this commit converted and omitted the three in
// `reports.service.ts` — the ones WIC-1308 was about — so that claim was false
// for a quarter of the codebase: reinstating the original WIC-1308 defect in
// `getNeedsActionReport` left all 403 tests green. The invariant this table
// encodes is a bijection with `grep -rn 'parseCursor(' src/services/*.ts`
// (twelve lines, five files): every row below corresponds to one of those, and
// every one of those to a row. The case below checks that, per service.
describe('every paginated list endpoint rejects a malformed cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 'ZZZ~' decodes to a two-byte non-digit string; `parseInt` of it is `NaN`,
  // which Drizzle drops from the query entirely (silent page one).
  const MALFORMED = 'ZZZ~';
  // base64url of '-5'. Not falsy, so it survives as a bound parameter and
  // Postgres answers `OFFSET must not be negative` — a bare 500.
  const NEGATIVE = encode('-5');

  const CALL_SITES: Array<[string, (cursor: string) => Promise<unknown>]> = [
    ['catalog.listCompanies', (cursor) => catalogService.listCompanies({ cursor })],
    ['catalog.listJobFitTags', (cursor) => catalogService.listJobFitTags({ cursor })],
    ['catalog.listTechStackTags', (cursor) => catalogService.listTechStackTags({ cursor })],
    ['catalog.listBullets', (cursor) => catalogService.listBullets({ cursor })],
    ['catalog.listThemes', (cursor) => catalogService.listThemes({ cursor })],
    ['catalog.listDiffs', (cursor) => catalogService.listDiffs({ cursor })],
    // The odd one out: the param is `page`, not `cursor`.
    ['application.listApplications', (page) => applicationService.listApplications({ page })],
    ['coverLetter.listCoverLetters', (cursor) => coverLetterService.listCoverLetters({ cursor })],
    [
      'resumeVariant.listResumeVariants',
      (cursor) => resumeVariantService.listResumeVariants({ cursor }),
    ],
    // The three WIC-1308 fixed in place, before the decoder moved to
    // `lib/pagination.ts`. They were never covered at call-site level — not by
    // PR #113 and not by the first draft of this table (WIC-1335).
    ['reports.getNeedsActionReport', (cursor) => reportsService.getNeedsActionReport({ cursor })],
    ['reports.getStaleReport', (cursor) => reportsService.getStaleReport({ cursor })],
    ['reports.getClosedLoopReport', (cursor) => reportsService.getClosedLoopReport({ cursor })],
  ];

  // The row-name prefix each service file is spelled with. The only
  // hand-maintained half of the check below — and adding a service without
  // adding its entry here fails too, as an unmapped prefix.
  const SERVICE_FILES: Record<string, string> = {
    catalog: 'catalog.service.ts',
    application: 'application.service.ts',
    coverLetter: 'cover-letter.service.ts',
    resumeVariant: 'resume-variant.service.ts',
    reports: 'reports.service.ts',
  };

  // Guards the guard. `CALL_SITES` is hand-maintained, so on its own it can
  // only ever claim to be exhaustive; this counts. A new paginated endpoint
  // that lands without a row fails here rather than quietly shrinking the
  // coverage claim above — which is precisely how the three reports sites went
  // missing (WIC-1335). Compared per service rather than in total, so swapping
  // one service's row for another's does not net out to zero.
  it('covers every parseCursor call site in the services layer', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../src/services/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.service.ts'));
    const sources = await Promise.all(
      files.map((f) => readFile(new URL(f, dir), 'utf-8').then((body) => [f, body] as const))
    );

    const inSource: Record<string, number> = {};
    for (const [file, body] of sources) {
      const calls = body.match(/parseCursor\(/g)?.length ?? 0;
      if (calls) inSource[file] = calls;
    }

    const inTable: Record<string, number> = {};
    for (const [name] of CALL_SITES) {
      const file = SERVICE_FILES[name.split('.')[0]];
      expect(file, `no SERVICE_FILES entry for the \`${name}\` prefix`).toBeDefined();
      inTable[file] = (inTable[file] ?? 0) + 1;
    }

    expect(inTable).toEqual(inSource);

    // And nothing decodes a cursor behind the guard's back. `encodeCursor` and
    // `parseCursor` are the only two places `base64url` may appear.
    expect(sources.filter(([, body]) => body.includes('base64url')).map(([f]) => f)).toEqual([]);
  });

  it.each(CALL_SITES)('%s rejects a cursor that decodes to a non-number', async (_name, call) => {
    await expect(call(MALFORMED)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  });

  it.each(CALL_SITES)('%s rejects a negative offset', async (_name, call) => {
    await expect(call(NEGATIVE)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  });
});
