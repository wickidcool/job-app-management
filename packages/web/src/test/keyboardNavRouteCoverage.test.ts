import { describe, expect, it } from 'vitest';

import appSource from '../App.tsx?raw';

/**
 * WIC-2190 — a `*.keyboardNav.test.tsx` named for a route must name a route the app
 * actually renders.
 *
 * WHY. `renderReportPage(page, path)` (`test/reportsKeyboardNav.tsx:79-98`) does not look
 * the path up in `App.tsx`. It *synthesizes* the route from its own two arguments:
 *
 *     <MemoryRouter initialEntries={[path]}>
 *       <Routes>
 *         <Route path={path} element={page} />
 *
 * So the path string is a label, not a route lookup, and a suite written against a path
 * the app sends elsewhere is green and stays green. It asserts a conditional — "*if*
 * `/x` rendered this component, its cards would be keyboard-reachable" — whose antecedent
 * nothing checks.
 *
 * That is not hypothetical. WIC-2062 fixed bare-div navigation on "four Reports* pages";
 * `App.tsx:137-140` routes one of the four, `/reports/pipeline`, to
 * `<Navigate to="/applications" replace />`. Its suite has been green since, over a page
 * no user can open, and the page counted as covered in the a11y accounting.
 *
 * `routeOutline.render.test.tsx` already knows this — `/reports/pipeline` is listed in its
 * `NOT_A_RENDERED_ROUTE`. The keyboard-nav suites simply never consulted that knowledge.
 * This file is that missing link, and it deliberately mirrors the shape of the check in
 * `routeOutline.render.test.tsx`: the exclusions are data, so adding one is a visible edit.
 *
 * ⚠️ THE GUARD MUST BE ABLE TO FAIL. Every assertion here reports a defect by returning a
 * non-empty list, and all of them pass over an empty input — a broken glob, a regex that
 * matches nothing, or a classifier that calls every route live would each turn this file
 * green while measuring nothing. So the scope, the extraction and the classifier are each
 * pinned by their own positive control below, and `classifyRoute` is exercised on
 * synthetic source that MUST be reported. A tree-state assertion alone would pass just as
 * well with this file deleted.
 */

/**
 * Suites whose path is knowingly not a rendered route, and why.
 *
 * Stated as data rather than left implicit, exactly as `NOT_A_RENDERED_ROUTE` is in
 * `routeOutline.render.test.tsx`: the check below subtracts this set, so an addition is a
 * reviewable edit rather than a silent narrowing of what gets measured.
 */
const NOT_ROUTE_COVERAGE: Record<string, string> = {
  '/src/pages/ReportsPipeline.keyboardNav.test.tsx':
    'WIC-2062 fixed this page along with three live siblings, but /reports/pipeline is a ' +
    '<Navigate> (App.tsx:137-140) so no user reaches it. The suite is retained because the ' +
    'component is retained: constants/stale.drift.test.ts imports ReportsPipeline.tsx as ?raw ' +
    'and pins it in a scope control, so deleting the page fails that suite at import time. ' +
    'Tracked in WIC-2190; the delete-or-restore product call is WIC-1100.',
};

/** Every `pages/*.keyboardNav.test.tsx`, project-root-relative. */
const SUITES = import.meta.glob('/src/pages/*.keyboardNav.test.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Strips comments so a path written in prose cannot be read as a call argument. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The path literals a suite hands to `renderReportPage`.
 *
 * Matches the second argument only when it is a string literal. A computed path would
 * return nothing here and the suite would look pathless rather than wrong — acceptable
 * because there are none, and `everySuiteNamesAPath` below fails if that stops being true.
 */
function renderedPaths(source: string): string[] {
  return [...stripComments(source).matchAll(/renderReportPage\([\s\S]*?,\s*'([^']+)'\s*\)/g)].map(
    (match) => match[1]
  );
}

type RouteVerdict = 'renders-a-component' | 'navigates-away' | 'not-declared';

/**
 * How does `appSource` treat `path`?
 *
 * Splits on `<Route\b` so `<Routes>` — which shares the prefix — does not open a segment,
 * then reads the first `path="…"` in each segment and asks whether that segment's element
 * is a `<Navigate>`. A segment runs to the next `<Route`, which is where the element
 * expression ends for every route this app declares (none nest).
 *
 * Taken as a pure function of source text so the synthetic controls below can exercise it
 * on route tables that do not exist in the app.
 */
export function classifyRoute(source: string, path: string): RouteVerdict {
  const segments = stripComments(source)
    .split(/<Route\b/)
    .slice(1);

  for (const segment of segments) {
    const declared = segment.match(/path="([^"]+)"/);
    if (!declared || declared[1] !== path) continue;
    return /<Navigate\b/.test(segment) ? 'navigates-away' : 'renders-a-component';
  }

  return 'not-declared';
}

describe('classifyRoute actually discriminates (controls for the check below)', () => {
  /**
   * The guard's whole verdict rests on this function. A version that returned
   * `'renders-a-component'` unconditionally would make every assertion below pass, so it
   * is pinned on both answers against the real `App.tsx` before it is trusted, and then on
   * synthetic source for the cases the tree does not currently contain.
   */

  it('calls a live route live, on the real App.tsx', () => {
    expect(classifyRoute(appSource, '/reports/stale')).toBe('renders-a-component');
    expect(classifyRoute(appSource, '/reports/needs-action')).toBe('renders-a-component');
    expect(classifyRoute(appSource, '/reports/closed-loop')).toBe('renders-a-component');
  });

  it('calls a <Navigate> route navigating, on the real App.tsx', () => {
    // The differential half. Without this the function could be a constant.
    expect(classifyRoute(appSource, '/reports/pipeline')).toBe('navigates-away');
    expect(classifyRoute(appSource, '/dashboard')).toBe('navigates-away');
  });

  it('reports a path App.tsx does not declare at all', () => {
    expect(classifyRoute(appSource, '/reports/does-not-exist')).toBe('not-declared');
  });

  it('reads the element, not the line — a multi-line <Navigate> is still navigating', () => {
    // `/reports/pipeline` is written across four lines in App.tsx, and `/dashboard` on
    // one. Both must classify the same or the guard is sensitive to formatting.
    const multiline = `
      <Route
        path="/multi"
        element={<Navigate to="/elsewhere" replace />}
      />
      <Route path="/single" element={<Real />} />
    `;
    expect(classifyRoute(multiline, '/multi')).toBe('navigates-away');
    expect(classifyRoute(multiline, '/single')).toBe('renders-a-component');
  });

  it('does not let one route’s <Navigate> leak into the next route’s verdict', () => {
    // The segment boundary is the load-bearing part of the split. If a segment ran past
    // the next `<Route`, the route following any redirect would be misread as navigating.
    const adjacent = `
      <Route path="/redirects" element={<Navigate to="/x" replace />} />
      <Route path="/follows" element={<Real />} />
    `;
    expect(classifyRoute(adjacent, '/redirects')).toBe('navigates-away');
    expect(classifyRoute(adjacent, '/follows')).toBe('renders-a-component');
  });

  it('is not confused by <Routes>, which shares the <Route prefix', () => {
    const nested = `
      <Routes>
        <Route path="/inner" element={<Real />} />
      </Routes>
    `;
    expect(classifyRoute(nested, '/inner')).toBe('renders-a-component');
  });
});

describe('the suite set this guard measures is the real one', () => {
  /**
   * An empty or truncated glob is a vacuous pass that looks exactly like a clean one, and
   * every assertion in the next block passes over zero suites. Pin the scope first.
   */

  const paths = Object.keys(SUITES).sort();

  it('finds the keyboardNav suites at all', () => {
    expect(paths).toContain('/src/pages/ReportsPipeline.keyboardNav.test.tsx');
    expect(paths).toContain('/src/pages/ReportsStale.keyboardNav.test.tsx');
    expect(paths).toContain('/src/pages/ReportsNeedsAction.keyboardNav.test.tsx');
    expect(paths).toContain('/src/pages/ReportsClosedLoop.keyboardNav.test.tsx');
    expect(paths.length).toBeGreaterThanOrEqual(4);
  });

  it('extracts a path from every suite it found (guards the regex against matching nothing)', () => {
    const pathless = paths.filter((path) => renderedPaths(SUITES[path]).length === 0);
    expect(pathless, 'keyboardNav suite whose renderReportPage path could not be read').toEqual([]);
  });

  it('reads the path a suite actually passes', () => {
    // Spot-check the extraction against a known literal rather than trusting the count.
    expect(renderedPaths(SUITES['/src/pages/ReportsStale.keyboardNav.test.tsx'])).toContain(
      '/reports/stale'
    );
  });
});

describe('every keyboardNav suite names a route the app renders', () => {
  it('reports no suite whose path is a <Navigate> or undeclared', () => {
    const offenders = Object.entries(SUITES)
      .filter(([file]) => !(file in NOT_ROUTE_COVERAGE))
      .flatMap(([file, source]) =>
        renderedPaths(source)
          .map((path) => ({ file, path, verdict: classifyRoute(appSource, path) }))
          .filter((entry) => entry.verdict !== 'renders-a-component')
          .map((entry) => `${entry.file} covers ${entry.path} — ${entry.verdict}`)
      );

    expect(offenders, 'keyboard-nav suite asserting coverage of a page no route renders').toEqual(
      []
    );
  });

  it('leaves no exclusion unexplained, and none stale', () => {
    // An allowlist nobody re-checks is how the next unrouted page gets a green suite.
    for (const [file, reason] of Object.entries(NOT_ROUTE_COVERAGE)) {
      expect(SUITES, `${file} is excluded but no longer exists`).toHaveProperty(file);
      expect(reason.length).toBeGreaterThan(10);

      // And the exclusion must still be *earned*: if the route were wired up, the entry
      // would be a lie that silently suppresses real coverage.
      const stillUnrendered = renderedPaths(SUITES[file]).some(
        (path) => classifyRoute(appSource, path) !== 'renders-a-component'
      );
      expect(
        stillUnrendered,
        `${file} is excluded but its route now renders — drop the entry`
      ).toBe(true);
    }
  });
});

describe('the guard can fail', () => {
  /**
   * The assertions above are all "this list is empty", and `offenders` is empty on a
   * healthy tree. An empty result is also what a broken guard returns, so reproduce the
   * defect on synthetic source and require it to be caught.
   */

  const APP_WITH_REDIRECT = `
    <Routes>
      <Route path="/reports/live" element={<ReportsLive />} />
      <Route path="/reports/dead" element={<Navigate to="/applications" replace />} />
    </Routes>
  `;

  const SUITE_SOURCE = (path: string) => `
    import { renderReportPage } from '../test/reportsKeyboardNav';
    function renderPage() {
      return renderReportPage(<ReportsThing />, '${path}');
    }
  `;

  function offendersFor(app: string, suites: Record<string, string>): string[] {
    return Object.entries(suites).flatMap(([file, source]) =>
      renderedPaths(source)
        .map((path) => ({ file, path, verdict: classifyRoute(app, path) }))
        .filter((entry) => entry.verdict !== 'renders-a-component')
        .map((entry) => `${entry.file} covers ${entry.path} — ${entry.verdict}`)
    );
  }

  it('catches a suite pointed at a redirected route', () => {
    expect(
      offendersFor(APP_WITH_REDIRECT, {
        'Dead.keyboardNav.test.tsx': SUITE_SOURCE('/reports/dead'),
      })
    ).toEqual(['Dead.keyboardNav.test.tsx covers /reports/dead — navigates-away']);
  });

  it('catches a suite pointed at a route that was deleted from App.tsx', () => {
    expect(
      offendersFor(APP_WITH_REDIRECT, {
        'Gone.keyboardNav.test.tsx': SUITE_SOURCE('/reports/gone'),
      })
    ).toEqual(['Gone.keyboardNav.test.tsx covers /reports/gone — not-declared']);
  });

  it('clears a suite pointed at a live route (so the check is not simply always-red)', () => {
    expect(
      offendersFor(APP_WITH_REDIRECT, {
        'Live.keyboardNav.test.tsx': SUITE_SOURCE('/reports/live'),
      })
    ).toEqual([]);
  });

  it('would catch the real ReportsPipeline suite if it were not excluded', () => {
    // The exclusion is the only reason the tree is green. Prove it is load-bearing rather
    // than decorative — otherwise a future edit could drop the entry and nothing would say so.
    expect(
      offendersFor(appSource, {
        '/src/pages/ReportsPipeline.keyboardNav.test.tsx':
          SUITES['/src/pages/ReportsPipeline.keyboardNav.test.tsx'],
      })
    ).toEqual([
      '/src/pages/ReportsPipeline.keyboardNav.test.tsx covers /reports/pipeline — navigates-away',
    ]);
  });
});
