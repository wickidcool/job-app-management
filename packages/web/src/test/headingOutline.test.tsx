import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { describeOutline, findOutlineSkips, getOutline } from './headingOutline';

/**
 * Cover for the outline helper itself.
 *
 * `getOutline` is shared guard infrastructure — `KanbanBoard.test.tsx` and
 * `CoverLetterPreview.test.tsx` both delegate their acceptance criteria to it, and
 * `docs/design/COMPONENT_SPECS.md` §10 points the per-page WCAG audit (WIC-1483) at it
 * next. A guard that everything else trusts needs its own inversion, because its failure
 * mode is *silence* rather than a wrong answer: `findOutlineSkips` reports a problem by
 * returning a **non-empty** array, so anything that makes one entry uncomparable turns a
 * broken page into a clean report instead of an error.
 *
 * The tests below therefore come in pairs wherever they can. Asserting that a well-formed
 * page reports `[]` is nearly free of information — an unconditional `return []` passes it.
 * What discriminates is the same page with a real skip in it reporting exactly one, and the
 * *identical* page expressed in `role="heading"` reporting the same count as its native-tag
 * twin. That last pairing is the control on the control: it is what makes "the ARIA form
 * cannot be walked around" an assertion rather than a claim in a docstring.
 */
describe('getOutline / findOutlineSkips', () => {
  it('reads native tags in document order', () => {
    const { container } = render(
      <>
        <h1>Page</h1>
        <h2>Section</h2>
        <h3>Sub</h3>
      </>
    );

    expect(describeOutline(getOutline(container))).toBe('h1 "Page" -> h2 "Section" -> h3 "Sub"');
    expect(findOutlineSkips(getOutline(container))).toEqual([]);
  });

  it('flags a descent of more than one level, and only the descent', () => {
    const { container } = render(
      <>
        <h1>Page</h1>
        <h3>Skipped past h2</h3>
        <h1>Back up two, which is fine</h1>
      </>
    );

    const skips = findOutlineSkips(getOutline(container));

    expect(skips).toHaveLength(1);
    expect(skips[0]?.from.text).toBe('Page');
    expect(skips[0]?.to.text).toBe('Skipped past h2');
  });

  it('honours an explicit aria-level on a role="heading" element', () => {
    const { container } = render(
      <>
        <h1>Page</h1>
        <div role="heading" aria-level={4}>
          Deep
        </div>
      </>
    );

    expect(describeOutline(getOutline(container))).toBe('h1 "Page" -> h4 "Deep"');
    expect(findOutlineSkips(getOutline(container))).toHaveLength(1);
  });

  it('treats role="heading" with no aria-level as level 2, per ARIA', () => {
    // eslint-disable-next-line jsx-a11y/role-has-required-aria-props -- unlevelled on purpose: the absent aria-level IS the fixture (WIC-1483)
    const { container } = render(<div role="heading">Section</div>);

    expect(getOutline(container)).toEqual([{ level: 2, text: 'Section' }]);
  });

  it('does not let an unlevelled role="heading" mask a skip on either side of it', () => {
    // The fail-open this exists to pin. To assistive tech the middle element is level 2, so
    // the page really is h1 -> h2 -> h4 and the h2 -> h4 step is a genuine skip. Resolve the
    // middle entry to `NaN` instead and *both* comparisons that touch it evaluate false, so
    // the whole page reports clean and the guard silently stops guarding.
    const { container } = render(
      <>
        <h1>Page</h1>
        {/* eslint-disable-next-line jsx-a11y/role-has-required-aria-props -- unlevelled on purpose: the absent aria-level IS the fixture (WIC-1483) */}
        <div role="heading">Section</div>
        <h4>Deep</h4>
      </>
    );

    const skips = findOutlineSkips(getOutline(container));

    expect(skips).toHaveLength(1);
    expect(skips[0]?.from.text).toBe('Section');
    expect(skips[0]?.to.text).toBe('Deep');
  });

  it('ignores an unusable aria-level rather than going uncomparable on it', () => {
    // Same silence, reached by a second door: `aria-level` *present* but not a level.
    // Making the missing-attribute case default to 2 while `Number('abc')` still yields
    // `NaN` would close one entrance to the fail-open and leave the other open — the shape
    // where a guard reads as fixed and is not. A user agent ignores an invalid value, so
    // the native tag wins where there is one and ARIA's default applies where there is not.
    //
    // Built through `innerHTML` rather than JSX because React types `aria-level` as a
    // `number`, so the invalid values this test is *about* cannot be written as literals.
    // `getOutline` reads the DOM, and this is the same DOM.
    const container = document.createElement('div');
    container.innerHTML = [
      '<h1 aria-level="abc">Native tag wins</h1>',
      '<div role="heading" aria-level="">Empty</div>',
      '<div role="heading" aria-level="0">Below the minimum</div>',
      '<div role="heading" aria-level="1.5">Not an integer</div>',
    ].join('');

    expect(describeOutline(getOutline(container))).toBe(
      'h1 "Native tag wins" -> h2 "Empty" -> h2 "Below the minimum" -> h2 "Not an integer"'
    );
    expect(findOutlineSkips(getOutline(container))).toEqual([]);
  });

  it('reports the same skips for a page written in ARIA as for its native-tag twin', () => {
    // The control on the control. Every assertion above could be satisfied by a helper that
    // quietly dropped `role="heading"` entries, since a shorter outline has fewer places to
    // find a skip. Measuring the two spellings of one page against each other is what makes
    // the docstring's "could be walked around without ever going red" testable.
    const { container: native } = render(
      <>
        <h1>Page</h1>
        <h2>Section</h2>
        <h4>Deep</h4>
      </>
    );
    const { container: aria } = render(
      <>
        <div role="heading" aria-level={1}>
          Page
        </div>
        {/* eslint-disable-next-line jsx-a11y/role-has-required-aria-props -- unlevelled on purpose: the absent aria-level IS the fixture (WIC-1483) */}
        <div role="heading">Section</div>
        <div role="heading" aria-level={4}>
          Deep
        </div>
      </>
    );

    expect(describeOutline(getOutline(aria))).toBe(describeOutline(getOutline(native)));
    expect(findOutlineSkips(getOutline(aria))).toHaveLength(1);
    expect(findOutlineSkips(getOutline(native))).toHaveLength(1);
  });
});
