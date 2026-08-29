import { describe, it, expect } from 'vitest';
import { recommendationToFitTier } from '../src/services/reports.service.js';
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
