import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CoverLetterPreview } from './CoverLetterPreview';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';

/**
 * Regression cover for WIC-1563 (heading-level skip), following the criterion PR #182 /
 * WIC-1417 wrote into `docs/design/COMPONENT_SPECS.md` §10 → Accessibility → Heading level.
 *
 * `CoverLetterPreview` rendered its header as `<h3>`. It has two call sites:
 *
 *   - `CoverLetterDetail:161` — page `<h1>` "Cover Letter", then straight to this heading.
 *     `showExportActions={true}`, so the header renders. **h1 -> h3, a real skip.**
 *   - `CoverLetterGenerator:590` — nested under that component's own `<h2>`, so h3 would
 *     be right. But it passes `showExportActions={false}`, and the header lives inside
 *     `{showExportActions && ...}`, so **no heading renders there at all.**
 *
 * That second fact is why this is a tag correction and not a `headingLevel` prop. The
 * heading is rendered at exactly one depth, so a prop would have no call site able to pass
 * a non-default value — the "single call site → correct it in place" boundary in §10.
 * `describes the pane only when the export header is shown` below is what pins that
 * premise, so the ruling stops being an assumption the moment the generator changes.
 */

const LETTER = 'Dear Hiring Manager,\n\nI am writing to apply.\n\nSincerely,\nA. Candidate';

describe('CoverLetterPreview — heading level (WIC-1563)', () => {
  it('renders h2 under the page h1, leaving no gap in CoverLetterDetail s outline', () => {
    // The `CoverLetterDetail` shape: the preview is the sole content beneath the page h1.
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

  it('describes the pane only when the export header is shown', () => {
    // The load-bearing premise of the fix above. `CoverLetterGenerator` passes
    // `showExportActions={false}`, so the component contributes no heading to that page's
    // outline and there is only one depth to be correct at. If this ever goes red, the
    // heading has become a host decision and §10 says it earns a `headingLevel` prop
    // (h2 for the detail page, h3 beside the generator's "📝 Editor") — see WIC-1569.
    const { container } = render(<CoverLetterPreview content={LETTER} showExportActions={false} />);

    expect(getOutline(container)).toEqual([]);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('adds no skip to the generator s outline in the shape that page renders', () => {
    // The `CoverLetterGenerator` shape end to end: its own h2, the "Editor" pane heading,
    // then the preview pane beside it. Asserted as a whole outline rather than as "the
    // preview has no heading", so that whatever the preview does contribute stays legal.
    const { container } = render(
      <>
        <h2>Generate Cover Letter</h2>
        <div>
          <h3>📝 Editor</h3>
        </div>
        <div>
          <CoverLetterPreview content={LETTER} showExportActions={false} />
        </div>
      </>
    );

    const outline = getOutline(container);
    expect(findOutlineSkips(outline)).toEqual([]);
    expect(outline.map((h) => h.level)).toEqual([2, 3]);
  });
});
