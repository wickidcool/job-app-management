import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StarEntryPicker } from './StarEntryPicker';
import type { CatalogEntry } from '../services/api/types';
import { ratio } from '../types/units';

/**
 * Unit cover for WIC-1521 / ADR-008 §1.
 *
 * `CatalogEntry.relevanceScore` is a ratio in `[0, 1]`. `StarEntryPicker` used to split on
 * `>= 80` and render `{score}%` raw, which is the 0-100 reading. Nothing failed, because the
 * field's only producer (`catalog.service.ts`) hardcodes `relevanceScore: undefined` — the
 * defect was latent, waiting for the job-fit path to start populating it. On that day no entry
 * could ever clear `0.85 >= 80`, so the "Recommended" section would have been *structurally*
 * empty, and any badge that did render would have read `0.85%`.
 *
 * Why this file exists even though the field is now branded `Ratio`: **the brand does not
 * catch either half of that bug.** `Ratio` is `number & {...}`, so `score >= 80` is a
 * well-typed comparison and `{score}%` is a well-typed render — arithmetic and JSX both erase
 * the brand. What the brand catches is the cross-layer *assignment* (a `Percent`, or a bare
 * `number` from a wire parse, landing in this field), and that is pinned separately in
 * `describe('the Ratio brand')` below. The threshold and the render need a test, and this is
 * it. Both halves were mutation-checked against the pre-fix source.
 */

const baseEntry: Omit<CatalogEntry, 'id' | 'title' | 'relevanceScore'> = {
  situation: 'Team was missing its release train',
  task: 'Get the release cadence back to weekly',
  action: 'Rebuilt the CI pipeline',
  result: 'Cut build time from 40 minutes to 6',
  tags: ['delivery'],
};

function entry(id: string, title: string, score?: number): CatalogEntry {
  return {
    ...baseEntry,
    id,
    title,
    ...(score === undefined ? {} : { relevanceScore: ratio(score) }),
  };
}

function renderPicker(entries: CatalogEntry[]) {
  return render(
    <StarEntryPicker entries={entries} selectedIds={[]} onSelectionChange={() => {}} />
  );
}

/**
 * The "Recommended" list and the "All Catalog Entries" list render identical cards, so
 * membership has to be read from the section, not from the page. Both sections are a `div`
 * wrapping an `h3` plus the card list, so the heading's parent is the section.
 *
 * The patterns are unanchored because each heading opens with a decorative emoji span, which
 * the accessible-name computation folds in ("🎯 Recommended (from fit analysis)").
 */
const RECOMMENDED_HEADING = /Recommended \(from fit analysis\)/;
const OTHER_HEADING = /Catalog Entries$/;

function sectionFor(headingPattern: RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { name: headingPattern });
  const section = heading.parentElement;
  if (!section) {
    throw new Error(`heading ${headingPattern} has no parent section`);
  }
  return section;
}

const recommendedSection = () => sectionFor(RECOMMENDED_HEADING);
const otherSection = () => sectionFor(OTHER_HEADING);

describe('StarEntryPicker relevance is a ratio in [0, 1]', () => {
  it('puts a 0.85 entry in Recommended and renders it as 85%', () => {
    renderPicker([entry('a', 'Rebuilt CI', 0.85)]);

    // The acceptance criterion, both halves. Pre-fix this section did not exist at all
    // (`0.85 >= 80` is false for every entry, so `recommendedEntries.length` was 0 and the
    // whole block was conditioned out), and the badge would have read "0.85%".
    expect(within(recommendedSection()).getByText('Rebuilt CI')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.queryByText('0.85%')).not.toBeInTheDocument();
  });

  it('leaves a 0.5 entry out of Recommended and renders no badge for it', () => {
    renderPicker([entry('a', 'Ran a retro', 0.5)]);

    // No entry clears the threshold, so the Recommended block is conditioned out entirely.
    expect(screen.queryByRole('heading', { name: RECOMMENDED_HEADING })).not.toBeInTheDocument();
    expect(within(otherSection()).getByText('Ran a retro')).toBeInTheDocument();
    // `showRelevance` is false outside Recommended, so no percentage is shown at all.
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('treats the 0.8 boundary as recommended and 0.79 as not', () => {
    renderPicker([entry('a', 'On the line', 0.8), entry('b', 'Just under', 0.79)]);

    expect(within(recommendedSection()).getByText('On the line')).toBeInTheDocument();
    expect(within(recommendedSection()).queryByText('Just under')).not.toBeInTheDocument();
    expect(within(otherSection()).getByText('Just under')).toBeInTheDocument();
  });

  it('partitions every entry into exactly one of the two sections', () => {
    // `recommendedEntries` and `otherEntries` are two independent predicates over the same
    // array rather than one split, so an entry can in principle land in both or neither.
    // `undefined` is the case that breaks a naive `>=` / `<` pair, and `0` is the case a
    // truthiness test would reclassify.
    const entries = [
      entry('a', 'Scored high', 0.9),
      entry('b', 'Scored low', 0.2),
      entry('c', 'Scored zero', 0),
      entry('d', 'Unscored'),
    ];
    renderPicker(entries);

    const recommended = recommendedSection();
    const other = otherSection();
    const placement = entries.map((e) => ({
      title: e.title,
      inRecommended: within(recommended).queryAllByText(e.title).length,
      inOther: within(other).queryAllByText(e.title).length,
    }));

    expect(placement).toEqual([
      { title: 'Scored high', inRecommended: 1, inOther: 0 },
      { title: 'Scored low', inRecommended: 0, inOther: 1 },
      { title: 'Scored zero', inRecommended: 0, inOther: 1 },
      { title: 'Unscored', inRecommended: 0, inOther: 1 },
    ]);
  });

  /**
   * A control that cannot expire.
   *
   * The WIC-1514 failure mode was a conversion that *compiled and ran* but collapsed its
   * input range — `Math.round(r)` over `r ∈ [0, 1]` has exactly two possible outputs, so five
   * different response rates all rendered as "0%" or "1%" and every single-value assertion
   * still passed. Asserting one number cannot see that. Asserting that N distinct ratios
   * produce N distinct readings can, and keeps working no matter which ratios are chosen.
   */
  it('renders six distinct ratios as six distinct badges', () => {
    const scores = [0.8, 0.83, 0.85, 0.9, 0.97, 1];
    renderPicker(scores.map((s, i) => entry(`e${i}`, `Entry ${i}`, s)));

    const badges = within(recommendedSection())
      .getAllByText(/^\d+%$/)
      .map((el) => el.textContent);

    expect(badges).toHaveLength(scores.length);
    expect(new Set(badges).size).toBe(scores.length);
    expect(badges).toEqual(['80%', '83%', '85%', '90%', '97%', '100%']);
  });
});

describe('the Ratio brand on CatalogEntry.relevanceScore', () => {
  it('rejects a bare number and a percent-scaled value at the type level', () => {
    // `packages/web/tsconfig.app.json` has `include: ["src"]`, so this file is compiled by
    // `npm run typecheck` and these assertions are genuinely checked. Delete the `Ratio`
    // brand from `CatalogEntry.relevanceScore` and both lines fail with TS2578 ("Unused
    // '@ts-expect-error' directive") — which is what makes this falsifiable rather than
    // decorative.

    // @ts-expect-error a bare number carries no unit and cannot be a Ratio
    const fromWire: CatalogEntry = { ...baseEntry, id: 'a', title: 'A', relevanceScore: 0.85 };

    // @ts-expect-error 85 is the percent reading — the exact confusion ADR-008 exists to stop
    const asPercent: CatalogEntry = { ...baseEntry, id: 'b', title: 'B', relevanceScore: 85 };

    // Referenced so `noUnusedLocals` does not reject them; the assertions above are the point.
    expect([fromWire.id, asPercent.id]).toEqual(['a', 'b']);
  });
});
