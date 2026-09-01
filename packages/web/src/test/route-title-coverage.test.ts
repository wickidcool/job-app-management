import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import appSource from '../App.tsx?raw';
import { HOOK_TITLED_ROUTES, REDIRECT_ROUTES, STATIC_ROUTE_TITLES } from '../constants/title';

/**
 * The mechanism that makes a missing title impossible to ship (WIC-1089, AC8).
 *
 * `ROUTE_TITLE_CONVENTION.md` §7 AC8 asked only that a `<Route>` added without a title be
 * "visible as such in review", on the reasoning that co-locating the title with the path
 * in the route table is enough and a lint rule is not required. Co-location is not
 * available here: `route-integrity.test.ts` reads `App.tsx` as raw source and parses
 * `path="…" element={<X` out of the JSX, so turning the route table into a data array —
 * which is what a per-route `title` field would need — would silently gut both directions
 * of that audit. Rather than trade one guard for another, the titles live in
 * `constants/title.ts` and this test enforces the pairing that co-location would have
 * given for free. It is strictly stronger than review: CI fails, not a reviewer's eye.
 *
 * The parsers below are deliberately the same shape as `route-integrity.test.ts`'s. If
 * that file's parse of `App.tsx` is ever changed, this one must move with it — which is
 * why the "finds routes at all" guard is the first test in the file.
 */

/** Every `path` declared on a `<Route>` in App.tsx, including the catch-all. */
function declaredRoutePaths(source: string): string[] {
  const paths = source
    .split('<Route')
    .slice(1)
    .map((chunk) => /\bpath="([^"]+)"/.exec(chunk)?.[1])
    .filter((path): path is string => Boolean(path));

  // `/*` is the outer shell route — a mount point, not a destination. `*` is the real
  // 404 catch-all and does need a title, so unlike route-integrity.test.ts it stays.
  return [...new Set(paths)].filter((path) => path !== '/*');
}

/** The paths whose `<Route element>` is a `<Navigate>` — they redirect and never paint. */
function redirectPaths(source: string): string[] {
  const paths: string[] = [];

  for (const chunk of source.split('<Route').slice(1)) {
    const path = /\bpath="([^"]+)"/.exec(chunk)?.[1];
    const element = /\belement=\{\s*<\s*([A-Za-z][A-Za-z0-9_]*)/.exec(chunk)?.[1];
    if (path && element === 'Navigate') paths.push(path);
  }

  return paths;
}

const declared = declaredRoutePaths(appSource);
const titled = Object.keys(STATIC_ROUTE_TITLES);
const accounted = new Set([...titled, ...HOOK_TITLED_ROUTES, ...REDIRECT_ROUTES]);

describe('every route has a title (WIC-1089 AC1/AC8)', () => {
  it('mounts RouteTitle in the shell', () => {
    // Without this the entire mechanism can be deleted from App.tsx and every other test
    // in this file, plus RouteTitle.test.tsx, stays green — they all exercise the parts
    // in isolation. This is the one assertion that the parts are actually wired together.
    expect(appSource).toMatch(/<RouteTitle\s*\/>/);
    expect(appSource).toMatch(/from '\.\/components\/RouteTitle'/);
  });

  it('finds routes to check at all (guards the parse against silently matching nothing)', () => {
    // Without this the whole file passes vacuously the moment App.tsx's formatting moves.
    expect(declared.length).toBeGreaterThan(25);
    expect(declared).toContain('/');
    expect(declared).toContain('*');
  });

  it('accounts for every declared route exactly once', () => {
    const unaccounted = declared.filter((path) => !accounted.has(path));

    // If this fails you added a <Route> and no title. Add a row to STATIC_ROUTE_TITLES,
    // or — if the heading is a URL param, a wizard variant or an in-page stage — list the
    // path in HOOK_TITLED_ROUTES and call useDocumentTitle() from the page itself.
    expect(unaccounted).toEqual([]);
  });

  it('lists no route that App.tsx does not declare', () => {
    // The converse, so a deleted route leaves a dangling title behind it rather than
    // rotting quietly.
    const declaredSet = new Set(declared);
    const orphans = [...accounted].filter((path) => !declaredSet.has(path));

    expect(orphans).toEqual([]);
  });

  it('classifies the redirect-only routes as redirects, from App.tsx itself', () => {
    // Read out of the source rather than trusted from the constant, so marking a real
    // page as a redirect to dodge the coverage check above cannot pass.
    expect([...REDIRECT_ROUTES].sort()).toEqual(redirectPaths(appSource).sort());
  });

  it('gives no redirect route a title', () => {
    for (const path of REDIRECT_ROUTES) {
      expect(STATIC_ROUTE_TITLES[path]).toBeUndefined();
    }
  });
});

describe('opening a modal never changes document.title (AC7)', () => {
  // Enforced structurally rather than by rendering each dialog: the title is only ever
  // written by `useDocumentTitle`, so if no overlay calls it, no overlay can move it.
  // `RouteTitle` is the one component allowed to — it is the shell's route effect, not
  // an overlay. Everything else that titles a screen is a page, because a page is a route
  // and a route is the only thing a title may name.
  const modules = import.meta.glob('../{components,pages}/**/*.{ts,tsx}', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  const callers = Object.entries(modules)
    .filter(([path]) => !path.includes('.test.'))
    .filter(([, src]) => /\buseDocumentTitle\s*\(/.test(src))
    .map(([path]) => path.replace(/^\.\./, ''));

  it('finds the call sites at all (guards the glob)', () => {
    // Seven pages plus RouteTitle. A glob that matched nothing would make the next
    // assertion vacuous, which is exactly how this class of guard dies.
    expect(callers.length).toBeGreaterThan(5);
  });

  it('is called only from pages and from the shell route effect', () => {
    const fromComponents = callers.filter((path) => path.startsWith('/components/'));
    expect(fromComponents).toEqual(['/components/RouteTitle.tsx']);
  });

  it('is not called from an overlay parked under pages/', () => {
    // Belt and braces for the case the assertion above cannot see: an overlay that lives
    // in pages/ rather than components/ — e.g. QuickReferenceExport, the export modal on
    // /applications/:id/prep that already renders its own <h1>
    // (ROUTE_TITLE_CONVENTION.md §6.4).
    //
    // `Dialog` is matched with a negative lookahead for `Dialogue`. Without it this fires
    // on DialogueCapture.tsx, which is not an overlay at all — it is the page component
    // for /projects/new/dialogue, and one of the six routes that legitimately titles
    // itself. A name-shaped scanner over-matching an unrelated file is the ordinary
    // failure mode for a check like this, so the exclusion is stated, not silent.
    const overlays = callers
      .filter((path) => path.startsWith('/pages/'))
      .filter((path) => /Dialog(?!ue)|Modal|Overlay|Sheet|Drawer|Popover/.test(path));

    expect(overlays).toEqual([]);
  });
});

describe('route matching resolves to the right title', () => {
  // The trap RouteTitle.tsx exists to avoid: matching a real URL against only the
  // statically-titled paths lets the catch-all `*` outrank the dynamic routes, and every
  // application, project and variant page is titled "That page couldn't be found".
  const matchable = [...accounted].map((path) => ({ path }));

  const resolve = (pathname: string) => {
    const matched = matchRoutes(matchable, pathname)?.[0]?.route.path;
    return matched ? STATIC_ROUTE_TITLES[matched] : undefined;
  };

  it.each([
    ['/', 'Dashboard'],
    ['/applications', 'Applications'],
    ['/applications/new', 'New Application'],
    ['/reports/stale', 'Stale Applications'],
    ['/resumes/exports', 'Resume Exports'],
    ['/resumes/abc123/exports', 'Resume Exports'],
    ['/cover-letters/abc123', 'Cover Letter'],
    ['/applications/abc123/prep', 'Interview Preparation'],
  ])('titles %s as %s', (pathname, expected) => {
    expect(resolve(pathname)).toBe(expected);
  });

  it.each([
    '/applications/abc123',
    '/projects/acme',
    '/projects/acme/files/story.md',
    '/resume-variants/abc123',
    '/job-fit-analysis',
    '/projects/new/dialogue',
  ])('leaves %s to its own page hook', (pathname) => {
    expect(resolve(pathname)).toBeUndefined();
  });

  it('prefers a static segment over a dynamic one at the same depth', () => {
    // `/applications/new` and `/applications/:id` both match `/applications/new`; the
    // literal must win, or the New Application page is titled with the detail fallback.
    expect(resolve('/applications/new')).toBe('New Application');
    expect(resolve('/resume-variants/new')).toBe('Generate Resume Variant');
    expect(resolve('/cover-letters/new')).toBe('Generate Cover Letter');
    expect(resolve('/projects/new/dialogue')).toBeUndefined();
  });

  it('falls to the 404 title only for genuinely unmatched paths', () => {
    expect(resolve('/no-such-page')).toBe("That page couldn't be found");
    expect(resolve('/applications/abc/nope/deeper')).toBe("That page couldn't be found");
  });
});
