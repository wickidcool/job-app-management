import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CoverLetterPreview } from './CoverLetterPreview';
import type { CoverLetterVariant } from '../services/api/types';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';
import generatorSource from './CoverLetterGenerator.tsx?raw';
import detailSource from '../pages/CoverLetterDetail.tsx?raw';

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

/**
 * The level each host actually passes, read from the host's source.
 *
 * Everything above this line renders `CoverLetterPreview` directly, in a hand-built
 * approximation of each host's shape. That proves the component obeys the prop; it cannot
 * prove the host *passes* it. Deleting `headingLevel={3}` from `CoverLetterGenerator`
 * leaves every other test in this file green, which is the whole failure mode — an
 * assertion named after the acceptance criterion, sitting one layer away from the code the
 * criterion is about.
 *
 * Rendering the real `CoverLetterGenerator` is not a cheap alternative: the preview pane
 * lives at the end of a multi-step wizard behind API calls and generation state. Reading
 * the call site is, and `route-integrity.test.ts` already establishes `?raw` source audits
 * as how this repo guards exactly this class of gap.
 *
 * Comments are stripped before matching, deliberately. The JSX comment above the generator's
 * call site contains the literal string `headingLevel={3}` to explain it, so a naive regex
 * over the raw file would match the *explanation* and keep passing after the real attribute
 * was deleted — a guard that silently stops guarding.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function headingLevelPassedBy(source: string): number {
  const withoutComments = stripComments(source);

  const callSites = withoutComments.match(/<CoverLetterPreview\b[\s\S]*?\/>/g) ?? [];

  // Exactly one call site per host is part of the claim. Two would mean this function is
  // reporting one of them and silently ignoring the other. Destructured with a throw rather
  // than indexed because `toHaveLength` asserts without narrowing, and `callSites[0]` is
  // `string | undefined` here: `match() ?? []` infers as `[] | RegExpMatchArray`, and the
  // empty *tuple* has element type `undefined`. That is plain `strictNullChecks` — this
  // package does not set `noUncheckedIndexedAccess`, so a bare `string[]` would index to
  // `string` and this shape would not be needed.
  expect(callSites).toHaveLength(1);
  const [callSite] = callSites;
  if (!callSite) throw new Error('no <CoverLetterPreview> call site found');

  const explicit = callSite.match(/\bheadingLevel=\{(\d)\}/);
  // No attribute means the host relies on the default, which is 2. That is the intended
  // shape for `CoverLetterDetail`, so it has to read as a real answer, not as "not found".
  return explicit ? Number(explicit[1]) : 2;
}

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

  it('is asked for h3 by CoverLetterGenerator and h2 by CoverLetterDetail', () => {
    // The acceptance criterion is about the two hosts, so it is asserted about the two
    // hosts. The generator nests the pane under its own <h2> beside the "Editor" <h3>;
    // the detail page renders it as the sole content under its <h1>.
    expect(headingLevelPassedBy(generatorSource)).toBe(3);
    expect(headingLevelPassedBy(detailSource)).toBe(2);
  });

  it('has the generator keep its editor pane s emoji out of the heading s accessible name', () => {
    // The same gap `headingLevelPassedBy` exists to close, one component over. The outline
    // test below hand-builds `<span aria-hidden="true">📝</span> Editor` as its fixture, so
    // the fixture *contains the fix*: delete the real attribute from `CoverLetterGenerator`
    // and every test in this file stays green. The emoji is baked into heading text, which
    // is the one place it cannot be hidden by the caller — unwrapped, the heading announces
    // as "memo Editor". §10 and the changelog both assert that it is wrapped, so it is read
    // from the host's source rather than reproduced in a fixture.
    // Annotated `string[]` for the same reason `headingLevelPassedBy` destructures: `match()
    // ?? []` infers as `[] | RegExpMatchArray`, and the empty *tuple* contributes element type
    // `never`, which is what `.filter()`'s callback parameter collapses to. Nothing to do with
    // `noUncheckedIndexedAccess` — this package does not set it — it is plain inference over a
    // union that happens to include a zero-length tuple.
    const headings: string[] =
      stripComments(generatorSource).match(/<h3\b[^>]*>[\s\S]*?<\/h3>/g) ?? [];
    const editorHeadings = headings.filter((heading) => heading.includes('Editor'));

    // Exactly one, for the same reason as above: two would mean this is reporting on one
    // "Editor" heading and silently ignoring the other.
    expect(editorHeadings).toHaveLength(1);
    const [editorHeading] = editorHeadings;
    if (!editorHeading) throw new Error('no "Editor" <h3> found in CoverLetterGenerator');

    expect(editorHeading).toMatch(/<span\s+aria-hidden="true"\s*>\s*📝\s*<\/span>/);

    // Asserting the wrapper is present is not the same as asserting nothing escapes it —
    // a second, unwrapped emoji added beside it would satisfy the line above. The claim is
    // about the accessible name, so it is made about what is left once the hidden spans are
    // removed.
    const announced = editorHeading.replace(/<span\s+aria-hidden="true"\s*>[\s\S]*?<\/span>/g, '');
    expect(announced).not.toContain('📝');
  });

  it('adds no skip to the generator s outline in the shape that page renders', () => {
    // The `CoverLetterGenerator` step-4 shape: the step's own section heading, the "Editor"
    // pane heading, then the labelled preview pane beside it. Asserted as a whole outline
    // rather than as a per-component tag check, because the defect this closes was never
    // visible in one component's tag — it was the relationship between two panes.
    //
    // This is a hand-built stand-in for the host, so it can only show that the shape *is*
    // legal — never that the generator still emits it. Two guards elsewhere close that gap
    // and are the ones that fail when the host moves: `headingLevelPassedBy` above reads the
    // real call site, and `CoverLetterNew.test.tsx`'s per-step source sweep reads the real
    // step-4 branch. Keep this copy in step with them.
    //
    // It opened `<h2>Generate Cover Letter</h2>` until WIC-1581 deleted that heading from the
    // generator outright — a fixture asserting a shape the tree no longer had, still green.
    // That is the failure mode the paragraph above is about, caught on its first outing.
    const { container } = render(
      <>
        <h2>Review &amp; edit</h2>
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
      'h2 "Review & edit" -> h3 "📝 Editor" -> h3 "Cover Letter Preview"'
    );
  });
});

/**
 * The footer, which had no cover at all before WIC-2301 — no assertion in this file
 * mentioned the word count, the tone, or the `•` between them. Three defects lived in the
 * sixteen lines it occupies, and all three were visible in the rendered DOM.
 *
 * The root cause is one mistake made three times: **truthiness applied to a number whose
 * `0` is real.** `wordCount` is `number | undefined`, so `||` and `&&` both fold the
 * legitimate count `0` in with "no count supplied", and the component acted on the fold in
 * two different directions — recomputing a count the caller had authoritatively given it,
 * and rendering the bare number `0` as a text node where a labelled chip belonged.
 *
 * The `•` was the third: it lived *inside* the variant block, so it rendered whenever the
 * variant did, whether or not anything preceded it to separate.
 */
describe('footer stats (WIC-2301)', () => {
  const VARIANT: CoverLetterVariant = {
    tone: 'professional',
    length: 'standard',
    emphasis: 'balanced',
  };

  const footerOf = (container: HTMLElement) => {
    const footer = container.querySelector('.border-t');
    if (!footer) throw new Error('no footer rendered');
    return footer;
  };

  /**
   * `CoverLetterGenerator` passes `variant` and **no** `wordCount` — read off the host
   * source below rather than assumed, because the whole finding rests on that call shape.
   * A test that invented the shape would be pinning its own fixture.
   */
  it('is the generator that passes a variant and no wordCount', () => {
    const call = generatorSource.slice(
      generatorSource.indexOf('<CoverLetterPreview'),
      generatorSource.indexOf('/>', generatorSource.indexOf('<CoverLetterPreview')) + 2
    );
    expect(call).toContain('variant={variant}');
    expect(call).not.toContain('wordCount');
  });

  /** …and `CoverLetterDetail` that passes both, which is the `wordCount === 0` route. */
  it('is the detail page that passes a wordCount alongside the variant', () => {
    const call = detailSource.slice(
      detailSource.indexOf('<CoverLetterPreview'),
      detailSource.indexOf('/>', detailSource.indexOf('<CoverLetterPreview')) + 2
    );
    expect(call).toContain('wordCount={wordCount}');
    expect(call).toContain('variant={variant}');
    // The value it passes is `countWords(content)`, so `0` is reachable whenever the stored
    // content is blank — which `content: z.string().min(1)` on the API permits as `' '`.
    expect(detailSource).toContain('const wordCount = countWords(coverLetter.content)');
  });

  /**
   * The generator's own preview pane. Pre-fix this rendered
   * `•professional tone•standard length` — no count at all, opening on a dangling
   * separator — while the editor pane immediately beside it showed a word count. The
   * `calculatedWordCount` fallback existed precisely for this caller and could never run,
   * because the chip displaying it was gated on the prop the caller does not pass.
   */
  it('shows a word count computed from content when the caller passes none', () => {
    const { container } = render(
      <CoverLetterPreview
        content={LETTER}
        variant={VARIANT}
        showExportActions={false}
        headingLevel={3}
      />
    );
    expect(footerOf(container).textContent).toContain('📊 11 words');
  });

  /**
   * The separator, asserted structurally rather than by string matching: the first element
   * in the footer row must be the count, so the `•` always has a left-hand side. Pre-fix
   * the first child *was* the `•`.
   */
  it('does not open the footer with a dangling separator', () => {
    const { container } = render(
      <CoverLetterPreview
        content={LETTER}
        variant={VARIANT}
        showExportActions={false}
        headingLevel={3}
      />
    );
    const row = footerOf(container).firstElementChild;
    expect(row?.firstElementChild?.textContent).toBe('📊 11 words');
    expect(footerOf(container).textContent?.startsWith('•')).toBe(false);
  });

  /**
   * The bare-`0` render. `{wordCount && …}` evaluates to the **number** `0`, which React
   * renders as a text node — so a blank letter's footer read `0•professional tone…`: an
   * unlabelled digit where "📊 0 words" belonged, and the one state in which the user most
   * needs to be told the count is zero rather than left to guess what the `0` refers to.
   */
  it('labels a zero count instead of rendering a bare 0', () => {
    const { container } = render(
      <CoverLetterPreview content="   " variant={VARIANT} wordCount={0} />
    );
    const footer = footerOf(container);
    expect(footer.textContent).toContain('📊 0 words');
    expect(footer.textContent?.startsWith('0')).toBe(false);
  });

  /**
   * A caller's authoritative `0` must survive, rather than being discarded by `||` and
   * recomputed from `content`. Content and count disagree here on purpose — that is the
   * only way to tell which of the two the component actually rendered.
   */
  it('honours an explicit zero over the content it disagrees with', () => {
    const { container } = render(
      <CoverLetterPreview content={LETTER} variant={VARIANT} wordCount={0} />
    );
    expect(footerOf(container).textContent).toContain('📊 0 words');
    expect(footerOf(container).textContent).not.toContain('11 words');
  });

  /**
   * The control. A non-zero `wordCount` was never affected by any of the three defects, and
   * this case renders byte-identically before and after the fix — which is what makes the
   * change a scoped repair of the zero/absent handling rather than a behaviour change to
   * the footer at large.
   */
  it('renders an ordinary non-zero count unchanged', () => {
    const { container } = render(
      <CoverLetterPreview content={LETTER} variant={VARIANT} wordCount={7} />
    );
    expect(footerOf(container).textContent).toBe('📊 7 words•professional tone•standard length');
  });

  /**
   * The outer guard, which the fix moved from truthiness to `!== undefined`. Both shipped
   * call sites pass a variant, so this shape is not reachable through the app today — it
   * pins the prop *contract* rather than a route, and is labelled as such so nobody reads
   * it as a user-facing claim. Without it the `||`→`!== undefined` change has no test that
   * dies when it is reverted, since a present variant carries the guard on its own.
   */
  it('renders the footer for an explicit zero even with no variant', () => {
    const { container } = render(<CoverLetterPreview content="   " wordCount={0} />);
    expect(footerOf(container).textContent).toBe('📊 0 words');
  });

  /** A caller with neither a count nor a variant still opts out of the footer entirely. */
  it('renders no footer when the caller supplies neither a count nor a variant', () => {
    const { container } = render(<CoverLetterPreview content={LETTER} />);
    expect(container.querySelector('.border-t')).toBeNull();
  });
});
