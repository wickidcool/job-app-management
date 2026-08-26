import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeRecommendation } from '../src/services/job-fit.service.js';
import type { FitMatchDTO, FitGapDTO } from '../src/services/job-fit.service.js';

/**
 * The by-fit-tier report's tiles print a one-line blurb under each tier name.
 * Those blurbs are a *claim about the scoring rule*, so they can be false — and
 * they were: WIC-1309 measured 81 of the 574 reachable scoring inputs in the
 * grid below landing in a tier whose blurb did not hold for them (the original
 * report's 32/252 was a coarser grid), because every blurb restated only the
 * match-percentage arm of `computeRecommendation`'s four-way cascade while the
 * cascade also branches on the critical-gap count and the seniority flag.
 *
 * The rule this file enforces: **each blurb must be a necessary condition of
 * its tier.** Not sufficient — a tile has no room to restate a whole cascade,
 * and it does not need to. It needs to never state something the tier it labels
 * can violate — e.g. captioning a 20-of-20 skill match "50–79% of required
 * skills", which is what the user then sees contradicted by `computeSummary`
 * on drill-in.
 *
 * Two halves, and both matter:
 *  1. `TIER_CLAIMS` pairs the exact shipped string with a predicate that encodes
 *     what that string asserts, and the predicate is checked against the real
 *     `computeRecommendation` over a dense grid.
 *  2. `blurbs as shipped` re-reads the strings out of the web source, so editing
 *     the copy without revisiting the predicate fails here rather than on screen.
 *
 * Copy is the Copywriter/Editor's to word (WIC-1318); this file only holds them
 * to being true.
 */

// ── The claims ───────────────────────────────────────────────────────────────

type Inputs = {
  matchPct: number;
  criticalGaps: number;
  hasSeniorityMismatch: boolean;
};

const TIER_CLAIMS: ReadonlyArray<{
  tier: 'strong_fit' | 'moderate_fit' | 'stretch' | 'low_fit';
  blurb: string;
  /** What the blurb asserts. Must hold for every input that produces `tier`. */
  holds: (i: Inputs) => boolean;
}> = [
  {
    tier: 'strong_fit',
    blurb: '80%+ of required skills, at most one critical gap',
    holds: ({ matchPct, criticalGaps }) => matchPct >= 0.8 && criticalGaps <= 1,
  },
  {
    tier: 'moderate_fit',
    blurb: '50%+ of required skills, up to three critical gaps, no seniority mismatch',
    holds: ({ matchPct, criticalGaps, hasSeniorityMismatch }) =>
      matchPct >= 0.5 && criticalGaps <= 3 && !hasSeniorityMismatch,
  },
  {
    tier: 'stretch',
    // A disjunction, because the tier is one: it catches a middling match, a
    // good match with more critical gaps than the tier above tolerates, and any
    // seniority mismatch at all.
    blurb: 'A partial skill match, too many critical gaps, or a seniority mismatch',
    holds: ({ matchPct, criticalGaps, hasSeniorityMismatch }) =>
      matchPct >= 0.3 || criticalGaps > 3 || hasSeniorityMismatch,
  },
  {
    tier: 'low_fit',
    blurb: 'Under 30% of required skills, and no seniority mismatch',
    holds: ({ matchPct, hasSeniorityMismatch }) => matchPct < 0.3 && !hasSeniorityMismatch,
  },
];

// ── The grid ─────────────────────────────────────────────────────────────────

const TOTAL_REQUIRED = 20;

const makeMatch = (matchType: 'exact' | 'alias'): FitMatchDTO => ({
  type: 'tech_stack',
  catalogEntry: 'react',
  jdRequirement: 'React',
  matchType,
  isRequired: true,
});

const makeGap = (severity: 'critical' | 'moderate'): FitGapDTO => ({
  type: 'tech_stack',
  jdRequirement: 'aws',
  isRequired: true,
  severity,
});

/**
 * Every reachable `(matchPct, criticalGaps, hasSeniorityMismatch)` triple, at
 * the resolution the scorer can actually distinguish.
 *
 * Match percentage moves in half-steps of one requirement because partial
 * (alias/related) matches weigh 0.5, so 41 distinct percentages are reachable
 * at `totalRequired = 20`. Critical gaps run past the ≤3 cascade bound so the
 * "high match, disqualified by gaps" region — where every violation WIC-1309
 * found lived — is covered on both sides of the boundary. A non-critical gap
 * rides along in every case to keep the severity filter honest.
 */
const GRID: ReadonlyArray<{ inputs: Inputs; matches: FitMatchDTO[]; gaps: FitGapDTO[] }> = (() => {
  const cases: Array<{ inputs: Inputs; matches: FitMatchDTO[]; gaps: FitGapDTO[] }> = [];
  for (let halfSteps = 0; halfSteps <= TOTAL_REQUIRED * 2; halfSteps++) {
    const weighted = halfSteps / 2;
    const exact = Math.floor(weighted);
    const partial = weighted % 1 === 0 ? 0 : 1;
    const matches = [
      ...Array.from({ length: exact }, () => makeMatch('exact')),
      ...Array.from({ length: partial }, () => makeMatch('alias')),
    ];
    for (let criticalGaps = 0; criticalGaps <= 6; criticalGaps++) {
      const gaps = [
        ...Array.from({ length: criticalGaps }, () => makeGap('critical')),
        makeGap('moderate'),
      ];
      for (const hasSeniorityMismatch of [false, true]) {
        cases.push({
          inputs: { matchPct: weighted / TOTAL_REQUIRED, criticalGaps, hasSeniorityMismatch },
          matches,
          gaps,
        });
      }
    }
  }
  return cases;
})();

const describeCase = (i: Inputs) =>
  `${Math.round(i.matchPct * 100)}% match, ${i.criticalGaps} critical gap(s)` +
  `${i.hasSeniorityMismatch ? ', seniority mismatch' : ''}`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('by-fit-tier tile blurbs', () => {
  it('states a necessary condition of its tier, for every reachable scoring input', () => {
    const violations: string[] = [];

    for (const { inputs, matches, gaps } of GRID) {
      const tier = computeRecommendation(
        matches,
        gaps,
        TOTAL_REQUIRED,
        inputs.hasSeniorityMismatch
      );
      if (tier === null) continue;

      const claim = TIER_CLAIMS.find((c) => c.tier === tier);
      if (!claim) {
        violations.push(`${tier}: no blurb is shipped for this tier`);
        continue;
      }
      if (!claim.holds(inputs)) {
        violations.push(`${describeCase(inputs)} → ${tier}, but its blurb says "${claim.blurb}"`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('covers all four verdict tiers, so the check above cannot pass vacuously', () => {
    const seen = new Set(
      GRID.map(({ inputs, matches, gaps }) =>
        computeRecommendation(matches, gaps, TOTAL_REQUIRED, inputs.hasSeniorityMismatch)
      ).filter((t): t is NonNullable<typeof t> => t !== null)
    );
    expect([...seen].sort()).toEqual(['low_fit', 'moderate_fit', 'stretch', 'strong_fit']);
  });

  it('matches the blurbs as shipped by the report page', () => {
    // Cross-package on purpose: the strings live in the web tiles, the rule they
    // describe lives in this package, and nothing else connects the two.
    const page = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'web',
      'src',
      'pages',
      'ReportsByFitTier.tsx'
    );
    const source = readFileSync(page, 'utf8');

    const shipped = new Map<string, string>();
    const entry = /tier:\s*'(strong_fit|moderate_fit|stretch|low_fit)',\s*\n\s*blurb:\s*'([^']*)'/g;
    for (const [, tier, blurb] of source.matchAll(entry)) shipped.set(tier, blurb);

    expect(Object.fromEntries(TIER_CLAIMS.map((c) => [c.tier, shipped.get(c.tier)]))).toEqual(
      Object.fromEntries(TIER_CLAIMS.map((c) => [c.tier, c.blurb]))
    );
  });
});
