import { describe, expect, it } from 'vitest';

import { formatSkillCount } from './skillCount';

/**
 * WIC-1528's fixture blind spot, closed.
 *
 * Every surface that pinned the `JobFitAnalysis` results screen used a mock where
 * all matches were required — 5 strong / 0 partial / all `isRequired` — which is
 * the one shape where "count of matches" and "count of required matches" coincide.
 * That is why `✅ Strong Matches (7)` above "You match 5 of 6 required skills"
 * survived to WIC-1301 without anyone seeing 7 > 6.
 *
 * The e2e fixture now carries a nice-to-have match (e2e/job-fit-analysis.spec.ts),
 * but a Playwright fixture is a mock and a mock can only disagree quietly. These
 * cases are the loud check: they enumerate the mixed shape directly, in the
 * package that owns the copy, and they run in `npm run test`.
 */
describe('formatSkillCount', () => {
  it('names both populations when the list is mixed', () => {
    // The shape the old bare `.length` rendered as an unexplained "7".
    const strongMatches = [
      ...Array.from({ length: 5 }, () => ({ isRequired: true })),
      ...Array.from({ length: 2 }, () => ({ isRequired: false })),
    ];

    expect(formatSkillCount(strongMatches)).toBe('5 required, 2 nice-to-have');
  });

  it('orders required before nice-to-have regardless of list order', () => {
    expect(
      formatSkillCount([{ isRequired: false }, { isRequired: true }, { isRequired: false }])
    ).toBe('1 required, 2 nice-to-have');
  });

  it('omits the zero term rather than rendering "0 nice-to-have"', () => {
    expect(formatSkillCount([{ isRequired: true }, { isRequired: true }])).toBe('2 required');
    expect(formatSkillCount([{ isRequired: false }])).toBe('1 nice-to-have');
  });

  it('does not pluralise, because the heading supplies the noun', () => {
    // Reads as "Strong Matches (1 required)", not "(1 requireds)".
    expect(formatSkillCount([{ isRequired: true }])).toBe('1 required');
  });

  it('falls back to a plain zero for an empty list', () => {
    // Unreachable from the UI — all three sections are gated on `.length > 0` —
    // but the function stays total.
    expect(formatSkillCount([])).toBe('0');
  });

  it('never reaches for a fraction or for reserved scale vocabulary', () => {
    // Guards the two copy rules in the module docblock: no second `X of Y` to
    // collide with the summary's "5 of 6 required skills" (WIC-1288), and none of
    // gap severity's or confidence's words (WIC-1301 / the fitLevel.ts guard).
    const rendered = [
      formatSkillCount([{ isRequired: true }, { isRequired: false }]),
      formatSkillCount([{ isRequired: true }]),
      formatSkillCount([{ isRequired: false }]),
      formatSkillCount([]),
    ].join(' | ');

    expect(rendered).not.toMatch(/\bof\b/);
    expect(rendered).not.toMatch(/\bfit\b/i);
    expect(rendered).not.toMatch(/\b(critical|moderate|minor|high|medium|low)\b/i);
  });
});
