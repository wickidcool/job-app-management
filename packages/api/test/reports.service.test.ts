import { describe, it, expect } from 'vitest';
import { recommendationToFitTier, parseCursor } from '../src/services/reports.service.js';
import { AppError } from '../src/types/index.js';
import type { FitRecommendation, FitTier } from '../src/types/index.js';

// WIC-1298. `FitRecommendation` (UC-3, one analysis) and `FitTier` (UC-5, a
// pipeline report) describe the same judgement. `recommendationToFitTier` is the
// only place they meet, and the contract it implements is written down in
// `docs/architecture/API_CONTRACTS.md` under GET /api/reports/by-fit-tier.
//
// These tests exist because the mapping is currently unreachable from the API:
// analyses are not persisted, so `getByFitTierReport` can only ever take the
// `not_analyzed` arm. Without them the other five arms would ship untested and
// stay that way until UC-3 persistence lands.

describe('recommendationToFitTier', () => {
  const RECOMMENDATIONS: FitRecommendation[] = ['strong_fit', 'moderate_fit', 'stretch', 'low_fit'];

  it.each(RECOMMENDATIONS)('maps a stored %s through unchanged', (recommendation) => {
    expect(recommendationToFitTier({ recommendation })).toBe(recommendation);
  });

  it('keeps stretch distinct from low_fit', () => {
    // The regression this whole ticket is about: the old `FitTier` had a single
    // `weak_fit` covering both. `stretch` also fires on a seniority mismatch at
    // a good skill match, so collapsing it reports "your skills are short" for a
    // finding that was "your level is wrong".
    expect(recommendationToFitTier({ recommendation: 'stretch' })).not.toBe(
      recommendationToFitTier({ recommendation: 'low_fit' })
    );
  });

  it('maps an analysis that could not score to unscored, not not_analyzed', () => {
    // `recommendation: null` — an empty catalog, or a JD with no required
    // skills. The analysis ran; it just has no verdict.
    expect(recommendationToFitTier({ recommendation: null })).toBe('unscored');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('maps a missing analysis (%s) to not_analyzed', (_label, analysis) => {
    expect(recommendationToFitTier(analysis)).toBe('not_analyzed');
  });

  it('distinguishes "never ran" from "ran and could not score"', () => {
    expect(recommendationToFitTier(null)).not.toBe(
      recommendationToFitTier({ recommendation: null })
    );
  });

  it('is total over FitTier — every tier is reachable', () => {
    // If a `FitTier` member has no input that produces it, the report has a
    // group nothing can ever land in. Listing the expected members by hand is
    // deliberate: this is a wire contract, so a change here should be a visible
    // edit to a test, not an inference from the type it is testing.
    const reachable = new Set<FitTier>([
      ...RECOMMENDATIONS.map((recommendation) => recommendationToFitTier({ recommendation })),
      recommendationToFitTier({ recommendation: null }),
      recommendationToFitTier(null),
    ]);

    expect([...reachable].sort()).toEqual(
      ['low_fit', 'moderate_fit', 'not_analyzed', 'strong_fit', 'stretch', 'unscored'].sort()
    );
  });
});

// WIC-1308. The predecessor of `parseCursor` wrapped its body in a `try`/`catch`
// that could not fire, because `Buffer.from(s, 'base64url')` does not throw on
// invalid input. The intended fallback therefore never happened and `NaN`
// reached `.offset()` in all three paginated reports.
describe('parseCursor', () => {
  const encode = (offset: string) => Buffer.from(offset).toString('base64url');

  it.each([
    ['undefined', undefined],
    ['the empty string', ''],
  ])('treats %s as the first page', (_label, cursor) => {
    expect(parseCursor(cursor)).toBe(0);
  });

  it.each([0, 1, 50, 1_000_000])('round-trips the offset %i this module issued', (offset) => {
    expect(parseCursor(encode(String(offset)))).toBe(offset);
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
    for (const cursor of [undefined, '', encode('0'), encode('42')]) {
      const offset = parseCursor(cursor);
      expect(Number.isSafeInteger(offset)).toBe(true);
      expect(offset).toBeGreaterThanOrEqual(0);
    }
  });
});
