import { describe, expect, it } from 'vitest';

import { formatRequirement, REQUIREMENT_SEPARATOR } from './requirementLabel';
import { formatSkillCount } from './skillCount';

/**
 * WIC-1534: required-ness must be *stated* on a row, never inferred from an
 * absence.
 *
 * The defect this closes was not a wrong string — it was a missing one. Strong
 * -match rows rendered a `Required` badge or nothing, so "nice-to-have" was
 * carried by the absence of chrome; partial-match rows rendered neither. A
 * fixture cannot catch that, because a mock that renders nothing and a
 * component that renders nothing agree. These cases are the loud check: they
 * assert both branches produce a non-empty, distinct, self-describing string.
 */
describe('formatRequirement', () => {
  it('states both branches, so an absence is never the signal', () => {
    expect(formatRequirement(true)).toBe('Required skill');
    expect(formatRequirement(false)).toBe('Nice-to-have skill');
  });

  it('never returns empty or whitespace for either branch', () => {
    // The regression that mattered: `false` rendering as nothing at all.
    for (const branch of [true, false]) {
      expect(formatRequirement(branch).trim()).not.toBe('');
    }
  });

  it('renders the two branches distinguishably without relying on colour', () => {
    // WIC-1146's rule, applied one axis over: the word does the work, because a
    // red chip is invisible under colour-vision deficiency (WCAG 1.4.1). Not a
    // substring of each other either, so a truncated row cannot read as the
    // opposite value.
    const required = formatRequirement(true);
    const niceToHave = formatRequirement(false);

    expect(required).not.toBe(niceToHave);
    expect(niceToHave.includes(required)).toBe(false);
    expect(required.includes(niceToHave)).toBe(false);
  });

  it('carries the noun the heading elides', () => {
    // `skillCount.ts` drops "skill" because the heading supplies it; a row has
    // no supplier, so it carries the noun itself. Same vocabulary, two
    // altitudes — see the module docblock.
    expect(formatRequirement(true)).toMatch(/skill$/);
    expect(formatRequirement(false)).toMatch(/skill$/);
    expect(formatSkillCount([{ isRequired: true }])).not.toMatch(/skill/);
  });

  it('stays on the requirement axis — no "fit", no reserved scale word', () => {
    // WIC-1301: the verdict axis owns "fit", the match-classification axis owns
    // "match". WIC-1146: critical/moderate/minor belong to gap severity, and
    // high/medium/low to confidence. A row qualifier may borrow none of them.
    const rendered = [formatRequirement(true), formatRequirement(false)].join(' | ');

    expect(rendered).not.toMatch(/\bfit\b/i);
    expect(rendered).not.toMatch(/\b(critical|moderate|minor|high|medium|low)\b/i);
  });

  it('agrees with the heading formatter on which word names which branch', () => {
    // The heading and the rows beneath it must not disagree (WIC-1528). If
    // either formatter is ever re-worded, this fails rather than letting the
    // section quietly contradict itself.
    expect(formatRequirement(true).toLowerCase()).toContain('required');
    expect(formatSkillCount([{ isRequired: true }])).toContain('required');

    expect(formatRequirement(false).toLowerCase()).toContain('nice-to-have');
    expect(formatSkillCount([{ isRequired: false }])).toContain('nice-to-have');
  });

  it('separates with a spaced em dash, so the three sections cannot drift', () => {
    expect(REQUIREMENT_SEPARATOR).toBe(' — ');
    // Spaces are part of the constant: JSX collapses the newlines around it at
    // the call sites, so the padding cannot come from the markup.
    expect(REQUIREMENT_SEPARATOR.startsWith(' ')).toBe(true);
    expect(REQUIREMENT_SEPARATOR.endsWith(' ')).toBe(true);
  });
});
