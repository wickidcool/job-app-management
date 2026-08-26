import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CoverLetterPreview } from './CoverLetterPreview';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';

/**
 * Heading-level cover for `CoverLetterPreview`, following the criterion PR #182 / WIC-1417
 * wrote into `docs/design/COMPONENT_SPECS.md` §10 → Accessibility → Heading level.
 *
 * This file previously asserted the opposite of what it asserts now, and the reversal is
 * the point rather than churn. WIC-1563 measured the component as rendering its heading at
 * exactly **one** depth: the header lived inside `{showExportActions && ...}`, and the only
 * nested call site (`CoverLetterGenerator:590`) passes `false`. One depth means no host
 * decision to delegate, so §10 says correct the tag in place and do not add a prop — a
 * `headingLevel` with no call site able to pass a non-default value is a dead assignment
 * that reads as a fix. `describes the pane only when the export header is shown` pinned
 * that premise precisely so it would go red the day the premise stopped holding.
 *
 * WIC-1569 then ruled that the generator's preview pane must be labelled, which hoists the
 * heading out of the conditional and puts it at two depths for real. The old test went red,
 * which is the tripwire working, not a regression. What replaces it:
 *
 *   - `CoverLetterDetail:161` — page `<h1>` "Cover Letter", preview is its sole content.
 *     Takes the default, `h2`.
 *   - `CoverLetterGenerator:590` — nested under that component's `<h2>` at `:181`, beside
 *     the "📝 Editor" `<h3>` at `:561`. Passes `headingLevel={3}`.
 *
 * The `showExportActions={false}` case now asserts **both halves** of the split — heading
 * present, buttons absent — because a single-sided assertion lets the next person quietly
 * re-merge the two and re-create the conflation WIC-1569 fixed.
 */

const LETTER = 'Dear Hiring Manager,\n\nI am writing to apply.\n\nSincerely,\nA. Candidate';

describe('CoverLetterPreview — heading level (WIC-1563, WIC-1569)', () => {
  it('renders h2 by default, leaving no gap in CoverLetterDetail s outline', () => {
    // The `CoverLetterDetail` shape: the preview is the sole content beneath the page h1.
    // `headingLevel` is omitted deliberately — that call site relies on the default, so the
    // default is what this has to exercise.
    const { container } = render(
      <>
        <h1>Cover Letter</h1>
        <CoverLetterPreview content={LETTER} showExportActions={true} onCopy={() => {}} />
      </>
    );

    expect(screen.getByRole('heading', { name: 'Cover Letter Preview' })).toHaveProperty(
      'tagName',
      'H2'
    );

    const outline = getOutline(container);
    expect(describeOutline(outline)).toBe('h1 "Cover Letter" -> h2 "Cover Letter Preview"');
    expect(findOutlineSkips(outline)).toEqual([]);
  });

  it('leaves the export header as the page s only h2, with nothing at h3', () => {
    // Pinned separately from the tag assertion above: `toHaveProperty('tagName', 'H2')`
    // still passes if a *second*, deeper heading is added beside it, which is exactly how
    // the original skip would creep back.
    render(
      <>
        <h1>Cover Letter</h1>
        <CoverLetterPreview content={LETTER} showExportActions={true} onCopy={() => {}} />
      </>
    );

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('renders h3 when the host asks for it', () => {
    render(<CoverLetterPreview content={LETTER} showExportActions={false} headingLevel={3} />);

    expect(screen.getByRole('heading', { name: 'Cover Letter Preview' })).toHaveProperty(
      'tagName',
      'H3'
    );
  });

  it('names the pane even when export actions are suppressed, without offering them', () => {
    // WIC-1569, and the whole of it: `showExportActions` gates the buttons and nothing else.
    // Both halves are asserted together on purpose. "Heading renders" alone would still pass
    // if someone moved the buttons back out of the conditional, and "buttons absent" alone
    // would still pass if they moved the heading back in — which is the exact defect this
    // replaced. Splitting these into two `it`s would lose that, so they stay in one.
    render(<CoverLetterPreview content={LETTER} showExportActions={false} onCopy={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Cover Letter Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });

  it('keeps the heading s rendered size independent of its level', () => {
    // §10: semantic depth is the host's decision, visual weight is the component's, and the
    // two must move independently. The level was hardcoded in the first place precisely
    // because the tag was standing in for the size (WIC-1417); this is what stops that
    // coupling being reintroduced through the new prop.
    const levels = [2, 3, 4, 5, 6] as const;

    const classLists = levels.map((level) => {
      const { unmount } = render(
        <CoverLetterPreview content={LETTER} showExportActions={false} headingLevel={level} />
      );
      const heading = screen.getByRole('heading', { name: 'Cover Letter Preview' });
      expect(heading.tagName).toBe(`H${level}`);
      const className = heading.className;
      unmount();
      return className;
    });

    expect(new Set(classLists).size).toBe(1);
    expect(classLists[0]).toContain('text-lg');
    expect(classLists[0]).toContain('font-semibold');
  });

  it('keeps the header bar padding matched to the generator s editor pane', () => {
    // The visual half of WIC-1569, and the half with no other cover. In the generator both
    // bars are `py-3` + a heading line-box and neither has buttons, so they are pixel
    // identical at 3.25rem; `p-4` here leaves the two panes 8px out of true, which is the
    // misalignment the ruling was filed on. Nothing else in the suite would notice a revert,
    // so it is asserted directly against the editor bar's literal classes
    // (`CoverLetterGenerator:560`) rather than left to review.
    const { container } = render(
      <CoverLetterPreview content={LETTER} showExportActions={false} headingLevel={3} />
    );

    const bar = container.querySelector('.border-b');
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass('px-4', 'py-3');
    expect(bar).not.toHaveClass('p-4');
  });

  it('adds no skip to the generator s outline in the shape that page renders', () => {
    // The `CoverLetterGenerator` shape end to end: its own h2, the "Editor" pane heading,
    // then the labelled preview pane beside it. Asserted as a whole outline rather than as a
    // per-component tag check, because the defect this closes was never visible in one
    // component's tag — it was the relationship between two panes.
    const { container } = render(
      <>
        <h2>Generate Cover Letter</h2>
        <div>
          <h3>
            <span aria-hidden="true">📝</span> Editor
          </h3>
        </div>
        <div>
          <CoverLetterPreview content={LETTER} showExportActions={false} headingLevel={3} />
        </div>
      </>
    );

    const outline = getOutline(container);
    expect(findOutlineSkips(outline)).toEqual([]);
    expect(outline.map((h) => h.level)).toEqual([2, 3, 3]);
    expect(describeOutline(outline)).toBe(
      'h2 "Generate Cover Letter" -> h3 "📝 Editor" -> h3 "Cover Letter Preview"'
    );
  });
});
