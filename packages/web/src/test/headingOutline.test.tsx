import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Dialog from '@radix-ui/react-dialog';

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

/**
 * The outline is the *accessibility tree's*, not the DOM's (WIC-1886).
 *
 * These exist because of one concrete failure: on a **modal-bodied route** — a route whose
 * entire body is an always-open Radix dialog — Radix's `hideOthers()` marks everything
 * outside the portal `aria-hidden="true"`. The page file is outside the portal for the
 * whole life of the route, so an `<h1>` placed there per `ROUTE_HEADING_OUTLINE.md` §5
 * rule 1 reaches no screen reader. Counting it lets the WIC-1675 route sweep certify that
 * non-fix green, and the sweep's `MISSING_H1` ratchet actively invites making it.
 *
 * The first test below is the one that discriminates, and it is why `getOutline` uses
 * `closest()` rather than reading the attribute off the heading: **Radix hides an ancestor,
 * never the heading itself.** A node-level filter passes every other test in this block and
 * is a no-op on the real defect — it was measured, and it left the route sweep green.
 */
describe('getOutline skips what assistive tech cannot reach', () => {
  it('excludes a heading whose ANCESTOR is aria-hidden, not just one marked itself', () => {
    const { container } = render(
      <>
        <div aria-hidden="true">
          <h1>Hidden page heading</h1>
        </div>
        <h2>Reachable section</h2>
      </>
    );

    // The heading carries nothing itself — the hiding is entirely on the wrapper.
    expect(container.querySelector('h1')?.getAttribute('aria-hidden')).toBeNull();
    expect(describeOutline(getOutline(container))).toBe('h2 "Reachable section"');
  });

  it('excludes a heading marked aria-hidden directly, and one under inert', () => {
    // `innerHTML` for the same reason the invalid-`aria-level` case above uses it: React 19
    // types `inert` as a boolean and drops the bare HTML attribute form, which is the form
    // this is about. `getOutline` reads the DOM, and this is the same DOM.
    const container = document.createElement('div');
    container.innerHTML = [
      '<h1 aria-hidden="true">Marked itself</h1>',
      '<div inert><h2>Under inert</h2></div>',
      '<h3>Reachable</h3>',
    ].join('');

    expect(describeOutline(getOutline(container))).toBe('h3 "Reachable"');
  });

  it('keeps aria-hidden="false", which does not hide anything', () => {
    const { container } = render(
      <div aria-hidden="false">
        <h1>Still reachable</h1>
      </div>
    );

    expect(describeOutline(getOutline(container))).toBe('h1 "Still reachable"');
  });

  it('drops the page h1 of a real modal-bodied route, keeping the dialog it hid it behind', () => {
    // Not a synthetic aria-hidden: Radix puts it there via hideOthers(), which is the
    // actual mechanism. If Radix ever stops hiding the page, this test says so.
    const { baseElement } = render(
      <div>
        <h1>Capture project dialogue</h1>
        <Dialog.Root open>
          <Dialog.Portal>
            <Dialog.Content aria-describedby={undefined}>
              <Dialog.Title asChild>
                <h1>New Project</h1>
              </Dialog.Title>
              <h2>Step section</h2>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    );

    // baseElement, not container: the dialog is portalled to document.body, which is also
    // what the WIC-1675 route sweep reads. Both headings are in the DOM here.
    expect(baseElement.querySelectorAll('h1')).toHaveLength(2);

    // ...but only the dialog's is in the accessibility tree, so the route opens at one h1.
    expect(describeOutline(getOutline(baseElement))).toBe('h1 "New Project" -> h2 "Step section"');
  });
});
