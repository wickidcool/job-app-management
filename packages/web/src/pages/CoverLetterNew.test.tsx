import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import coverLetterGeneratorSource from '../components/CoverLetterGenerator.tsx?raw';
import { describeOutline, findOutlineSkips, getOutline } from '../test/headingOutline';
import coverLetterNewSource from './CoverLetterNew.tsx?raw';

/**
 * WIC-1571 — `/cover-letters/new` had no `<h1>`.
 *
 * `CoverLetterNew` rendered `<CoverLetterGenerator>` inside a bare `<div>`, and no
 * shared layout supplies a heading, so the highest heading on the route was the
 * generator's own `<h2>Generate Cover Letter</h2>`. The outline started at `h2`
 * with nothing above it.
 *
 * These tests assert the **rendered outline** of the real page rather than tag names
 * in isolation. That distinction is load-bearing here, because there are two ways to
 * make "the page starts at h1" true and only one of them is correct:
 *
 *   ✅ the page emits the `<h1>`, and the generator's heading stays an `<h2>`;
 *   ❌ the generator's `<h2>` is promoted to `<h1>`.
 *
 * Both satisfy "the outline starts at 1". The second is wrong — a shared component
 * must not emit its host page's `<h1>` (`docs/design/COMPONENT_SPECS.md` §10 →
 * "Heading level": *"The page `<h1>` names the route"*), and promoting it would also
 * flatten `CoverLetterPreview`'s two render depths into one and un-earn the
 * `headingLevel` prop WIC-1569 justified by exactly that split. So the outline
 * assertions below are paired with source guards that pin **which file** owns each
 * heading — an outline assertion alone cannot tell the two fixes apart.
 */

/** Strips comments so a `<h1` mentioned in prose (including this file's own) cannot be counted. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function countOccurrences(source: string, needle: RegExp): number {
  return [...source.matchAll(needle)].length;
}

// The page's two data hooks. Stubbing these (rather than the network) keeps each of
// the page's four branches reachable by returning the state that selects it, while
// the page and CoverLetterGenerator underneath it stay the real components.
const useStarEntriesMock = vi.fn();
const useApplicationMock = vi.fn();

vi.mock('../hooks/useCatalog', () => ({
  useStarEntries: () => useStarEntriesMock(),
}));

vi.mock('../hooks/useApplications', () => ({
  useApplication: () => useApplicationMock(),
}));

const { CoverLetterNew } = await import('./CoverLetterNew');

const CATALOG_ENTRY = {
  id: 'star-1',
  situation: 'Checkout latency regressed after a release',
  task: 'Restore p95 under 400ms',
  action: 'Profiled the request path and cached the pricing lookup',
  result: 'p95 fell from 1.2s to 310ms',
  tags: ['performance'],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/cover-letters/new']}>
        <CoverLetterNew />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Selects the page's happy path: catalog loaded, at least one STAR entry. */
function seedLoadedCatalog() {
  useStarEntriesMock.mockReturnValue({
    data: [CATALOG_ENTRY],
    isLoading: false,
    error: undefined,
  });
  useApplicationMock.mockReturnValue({ data: undefined, isLoading: false });
}

beforeEach(() => {
  seedLoadedCatalog();
});

describe('/cover-letters/new document outline', () => {
  it('renders exactly one h1, and it names the route', () => {
    const { container } = renderPage();

    const h1s = container.querySelectorAll('h1');
    expect(
      h1s.length,
      `expected exactly one <h1>, outline was:\n${describeOutline(getOutline(container))}`
    ).toBe(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Generate Cover Letter');
  });

  it('starts the outline at h1 and skips no level on the way down', () => {
    const { container } = renderPage();
    const outline = getOutline(container);

    expect(outline.length, 'the page rendered no headings at all').toBeGreaterThan(1);
    expect(outline[0]?.level, `outline was:\n${describeOutline(outline)}`).toBe(1);
    expect(findOutlineSkips(outline), `outline was:\n${describeOutline(outline)}`).toEqual([]);
  });

  it("puts the generator's own first heading at level 2, directly beneath the page h1", () => {
    const { container } = renderPage();
    const outline = getOutline(container);

    // Position, not copy. The generator's heading text is WIC-1581's business
    // (ROUTE_HEADING_OUTLINE.md §4 renamed it once already); what this ticket owns is
    // that whatever it says lands one level below the page h1, with no gap.
    const generatorHeading = outline[1];
    expect(generatorHeading, `outline was:\n${describeOutline(outline)}`).toBeDefined();
    expect(generatorHeading?.level).toBe(2);
  });

  it('has no heading below the h1 repeat the route name', () => {
    // ROUTE_HEADING_OUTLINE.md §0 (WIC-1581): a component that is the sole body of a
    // route must not render a heading that names the route. `routeHeadingOutline.test.ts`
    // enforces that across the tree by intersecting *static* h1/h2 strings in source;
    // this is the same rule asserted on the *rendered* outline of this one route, so an
    // interpolated or dynamically-built repeat — which the source sweep cannot see, by
    // its own admission (WIC-1586) — still fails here.
    const { container } = renderPage();
    const outline = getOutline(container);
    const h1 = outline[0]?.text;

    expect(h1).toBe('Generate Cover Letter');
    expect(
      outline.slice(1).filter((n) => n.text === h1),
      `outline was:\n${describeOutline(outline)}`
    ).toEqual([]);
  });
});

describe('the h1 belongs to the route, not to the shared component', () => {
  // The outline tests above are satisfied by promoting CoverLetterGenerator's <h2>
  // to <h1>. These two are not — they are what makes the wrong fix fail.

  it('CoverLetterNew.tsx is the file that emits the h1', () => {
    expect(countOccurrences(stripComments(coverLetterNewSource), /<h1[\s>]/g)).toBe(1);
  });

  it('CoverLetterGenerator.tsx emits no h1, and still opens at h2', () => {
    const source = stripComments(coverLetterGeneratorSource);

    // The forbidden fix, stated directly: the shared component emits the page's h1.
    expect(countOccurrences(source, /<h1[\s>]/g)).toBe(0);

    // ...and the other way it can go wrong: deleting the component's top-level headings
    // instead of demoting the page's. Then the outline runs h1 -> h3 and the *rendered*
    // skip assertions above would be the only thing left holding it, on the one branch
    // they happen to render. `>= 1` rather than a count or a copy match on purpose —
    // WIC-1581 renamed these once already and may again; what must not change is that
    // the generator's sections open at 2, not 1 and not 3.
    expect(countOccurrences(source, /<h2[\s>]/g)).toBeGreaterThanOrEqual(1);
  });
});

describe("each of the generator's four steps is its own outline surface", () => {
  // The rendered tests above only ever reach step 1: the wizard advances on form
  // submission and, for step 4, on a completed generate mutation. So four of the five
  // outline surfaces this route can show are untested by them — the same shape as the
  // page's early-return branches, one component down.
  //
  // Asserted on source, per step, because *flat* order cannot see it. Delete step 4's
  // section heading and the file still reads h2 h2 h2 h2 h2 h3 in document order, which
  // is skip-free; it is only when the h3 is read as the first heading of its own branch
  // that the h1 -> h3 skip appears. Measured: a flat check passes that mutation.

  /** Source of each `{currentStep === N && ( ... )}` branch, keyed by step number. */
  function stepBranches(source: string): Map<number, string> {
    const marks = [...source.matchAll(/\{currentStep === (\d) &&/g)];

    return new Map(
      marks.map((mark, i) => [
        Number(mark[1]),
        source.slice(mark.index, marks[i + 1]?.index ?? source.length),
      ])
    );
  }

  const branches = stepBranches(stripComments(coverLetterGeneratorSource));

  // Cases come from a literal 1-2-3-4, not from what the regex happened to find. Driving
  // `it.each` off the matches instead looks equivalent and is not: rename the marker and
  // the parameterisation goes empty, so the sweep generates zero cases. That does fail —
  // an `expect` at collection time takes the whole file down — but it reports as
  // "Test Files 1 failed / Tests no tests", which reads as an infrastructure problem and
  // hides the other 14 cases in this file rather than naming the four that broke.
  it('finds all four of the generator s step branches', () => {
    expect([...branches.keys()].sort()).toEqual([1, 2, 3, 4]);
  });

  it.each([1, 2, 3, 4])('step %i opens at h2 and skips no level', (step) => {
    const body = branches.get(step);
    expect(body, `no {currentStep === ${step} && …} branch found`).toBeDefined();

    const levels = [...(body ?? '').matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

    expect(levels.length, 'this step renders no heading at all').toBeGreaterThan(0);

    // The page h1 is directly above every one of these, so 2 is both the floor and the
    // only legal opener. `Review & edit` on step 4 exists for exactly this line.
    expect(levels[0], `heading levels in this step: ${levels.join(', ')}`).toBe(2);
    expect(
      levels.filter((level, i) => i > 0 && level - Math.min(...levels.slice(0, i)) > 1),
      `heading levels in this step: ${levels.join(', ')}`
    ).toEqual([]);
  });
});

describe('the h1 survives every branch of the page', () => {
  // The loading, error and empty-catalog branches all return before
  // CoverLetterGenerator mounts. A heading placed next to the generator would leave
  // these three states with no heading at all.

  it('renders the h1 while the catalog is loading', () => {
    useStarEntriesMock.mockReturnValue({ data: undefined, isLoading: true, error: undefined });
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Generate Cover Letter');
    expect(screen.getByText('Loading STAR entries...')).toBeInTheDocument();
  });

  it('renders the h1 while the linked application is loading', () => {
    useApplicationMock.mockReturnValue({ data: undefined, isLoading: true });
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Generate Cover Letter');
    expect(screen.getByText('Loading application data...')).toBeInTheDocument();
  });

  it('renders the h1 when the catalog fails to load', () => {
    useStarEntriesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Generate Cover Letter');
    expect(screen.getByText('Failed to load STAR entries')).toBeInTheDocument();
  });

  it('renders the h1 when there are no STAR entries yet', () => {
    useStarEntriesMock.mockReturnValue({ data: [], isLoading: false, error: undefined });
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Generate Cover Letter');
    expect(screen.getByText('No STAR entries found')).toBeInTheDocument();
  });

  it('leaves no branch with a heading-level skip', () => {
    const branches: Array<[string, () => void]> = [
      [
        'loading',
        () =>
          useStarEntriesMock.mockReturnValue({
            data: undefined,
            isLoading: true,
            error: undefined,
          }),
      ],
      [
        'error',
        () =>
          useStarEntriesMock.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('boom'),
          }),
      ],
      [
        'empty',
        () => useStarEntriesMock.mockReturnValue({ data: [], isLoading: false, error: undefined }),
      ],
      ['loaded', seedLoadedCatalog],
    ];

    for (const [name, seed] of branches) {
      seedLoadedCatalog();
      seed();
      const { container, unmount } = renderPage();
      const outline = getOutline(container);

      expect(outline[0]?.level, `${name} branch outline:\n${describeOutline(outline)}`).toBe(1);
      expect(
        outline.filter((n) => n.level === 1),
        `${name} branch outline:\n${describeOutline(outline)}`
      ).toHaveLength(1);
      expect(
        findOutlineSkips(outline),
        `${name} branch outline:\n${describeOutline(outline)}`
      ).toEqual([]);
      unmount();
    }
  });
});
