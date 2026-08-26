import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import appSource from '../App.tsx?raw';

/**
 * A static audit of in-app navigation, in both directions:
 *
 *  - link -> route: every internal path the UI can send a user to must be matched by a
 *    concrete route in App.tsx.
 *  - route -> link: every route declared in App.tsx must have at least one inbound link
 *    site somewhere in the app, unless it is a `<Navigate>` redirect.
 *
 * The first exists because WIC-1032 shipped a "Go to Dashboard" button pointing at
 * `/dashboard`, which no route matched — the user landed on an empty content area.
 * Nothing in the type system or the linter can see that; only a run-time click could,
 * and clicking it in Playwright costs a dev server, an API and a database. Reading the
 * source and matching it against the route table costs nothing and runs in Lint & Test.
 *
 * The second exists because the first cannot see the converse. An orphan route — a page
 * that is built and mounted with no button anywhere pointing at it — produces no link
 * site, so the link -> route assertion has nothing to look at and stays green. That class
 * had produced four cards on this project (WIC-109, WIC-110, WIC-1428, WIC-1530) and
 * never once produced a guard; WIC-1531 is the guard.
 *
 * Two limits, so this is not over-trusted:
 *
 *  - It is static. A target computed at run time (`navigate(returnTo)`) is invisible to
 *    it — the same limitation the link -> route direction already documents and accepts.
 *  - It proves a link exists *in source*, not that a user can ever see it. A link inside
 *    a permanently false conditional, or on a page that is itself unreachable, satisfies
 *    it. This reduces the orphan class; it does not eliminate it.
 */

// Link targets that are known-dead today. Each entry must name the ticket that owns
// removing it. The audit fails on any dead link NOT in this list, so the list is a
// baseline, not an escape hatch.
//
// Entries are deliberately NOT asserted to still be dead. A staleness check would mean
// this test starts failing on main the moment one of the owning PRs merges, which would
// make it a hazard for other people's work rather than a guard on ours. Removing the
// entry is part of the owning ticket's close-out.
const KNOWN_DEAD_LINKS: Record<string, string> = {
  // WIC-1032 / PR #82 — nav and breadcrumb links to the pre-rename dashboard path.
  // The dashboard is mounted at `/`. PR #82 rewrites these; PR #83 additionally adds a
  // `/dashboard` -> `/` redirect route, after which this entry is simply inert.
  '/dashboard': 'WIC-1032 (PR #82) — dashboard is mounted at "/", not "/dashboard"',

  // WIC-1044 — ResumeManager "View Exports". Only the static `/resumes/exports` is
  // declared; the parameterized route this link assumes was never added (ResumeExports
  // reads a `resumeId` param its route does not declare).
  '/resumes/${resume.id}/exports': 'WIC-1044 — no /resumes/:resumeId/exports route',

  // WIC-1044 — InterviewPrepCard "Practice". `/applications/:id/prep` is declared with
  // no nested routes, so the extra `/practice` segment matches nothing.
  '/applications/${applicationId}/prep/practice':
    'WIC-1044 — no practice view mounted under /applications/:id/prep',

  // ProjectDetail empty-state "Upload Resume". Found by this audit, not by the manual
  // sweeps that produced WIC-1032 and WIC-1044 — it is a `window.location.href` write
  // rather than a `to=`/`navigate()` call, so those greps did not look at it. Reported
  // on WIC-1044 for its owner to fold in or split out.
  '/resume-manager': 'WIC-1044 (reported) — resume manager is mounted at /resumes',
};

/**
 * Every `path` declared on a `<Route>` in App.tsx.
 *
 * Catch-all patterns (`*`, `/*`) are dropped on purpose. They match every path by
 * definition, so leaving them in would make this audit vacuously pass — which is
 * exactly what would happen once the WIC-1036 catch-all 404 route lands.
 */
function declaredRoutePaths(source: string): string[] {
  const paths = source
    .split('<Route')
    .slice(1)
    .map((chunk) => /\bpath="([^"]+)"/.exec(chunk)?.[1])
    .filter((path): path is string => Boolean(path));

  return [...new Set(paths)].filter((path) => path !== '*' && path !== '/*');
}

/**
 * The component each `<Route>` renders, keyed by its declared `path`.
 *
 * Only used to spot `<Navigate>` — a redirect-only route exists precisely to absorb
 * traffic the app does *not* generate (bookmarks, stale external links, renamed paths),
 * so requiring it to have an inbound link would be backwards. Reading the element out of
 * the source keeps that exemption self-evident in App.tsx rather than in a hand-kept
 * allowlist here, which would need its own staleness guard.
 */
function declaredRouteElements(source: string): Record<string, string> {
  const elements: Record<string, string> = {};

  for (const chunk of source.split('<Route').slice(1)) {
    const path = /\bpath="([^"]+)"/.exec(chunk)?.[1];
    // Chunks end at the next `<Route`, so the first `element={<X` in one is that route's
    // own — no nested route's element can be read as this one's.
    const element = /\belement=\{\s*<\s*([A-Za-z][A-Za-z0-9_]*)/.exec(chunk)?.[1];

    if (path && element) {
      elements[path] = element;
    }
  }

  return elements;
}

/** Where a link target was written, for a failure message that points at the file. */
interface LinkSite {
  file: string;
  raw: string;
  path: string;
}

/**
 * Every shape a navigation target is authored in, in this codebase:
 *
 *  1. `to="/x"` / `href="/x"`            — plain JSX string attribute
 *  2. ``to={`/x/${id}`}`` / `href={'/x'}` — JSX expression attribute
 *  3. `path: '/x'`, `link: '/x'`, `actionPath: '/x'`, `href: '/x'`, `to:`, `url:`
 *                                        — the nav-config, breadcrumb-trail and
 *                                          command-palette object shapes, which are
 *                                          then spread onto `to={item.path}` etc.
 *  4. `navigate('/x')`                   — programmatic router navigation
 *  5. `window.location.href = '/x'`      — full-page navigation
 *
 * Only literals are visible here. A target computed at runtime (`navigate(returnTo)`)
 * is out of reach of a static audit; those are covered by the object-literal shapes in
 * (3) wherever the value originates from a nav config, which is the case throughout
 * this app today.
 */
const LINK_PATTERNS: RegExp[] = [
  /\b(?:to|href)="(\/[^"]*)"/g,
  /\b(?:to|href)=\{\s*['"`](\/[^'"`]*)['"`]\s*\}/g,
  /\b(?:to|href|url|link|[A-Za-z]*[Pp]ath)\s*:\s*['"`](\/[^'"`]*)['"`]/g,
  /\bnavigate\(\s*['"`](\/[^'"`]*)['"`]/g,
  /\blocation\.(?:href\s*=|assign\(|replace\()\s*['"`](\/[^'"`]*)['"`]/g,
];

/**
 * Reduce an authored link target to a concrete pathname that `matchRoutes` can test:
 * drop the query string and hash, then substitute a stand-in segment for every
 * `${...}` interpolation so `/applications/${id}` becomes `/applications/x`.
 */
function toConcretePathname(raw: string): string {
  return raw
    .split(/[?#]/)[0]
    .replace(/\$\{[^}]*\}/g, 'x')
    .replace(/\/$/, '') // trailing slash, except on the root path
    .replace(/^$/, '/');
}

/**
 * Strip comments before scanning. A link that has been commented out is not a link: the
 * button is gone from the UI and the page it reached is orphaned, which is precisely the
 * class the route -> link audit exists to catch (WIC-1428/WIC-1530). `collectLinkSites`
 * regexes over raw source, so without this a commented-out link still credits its route —
 * deleting a link is caught, but commenting the *same* link out is not, even though the
 * user-visible outcome (button gone, page unreachable) is identical. That is the single
 * most common way a page actually becomes orphaned, and it is cheap to exclude.
 *
 * The `[^:'"`\\]` guard on the line-comment rule keeps `https://` and `to="//x"` from
 * being eaten. It is a lexer-free approximation: a `//` inside a string literal that is
 * not preceded by `:` could over-strip, which is why the two block/JSX forms run first.
 * Measured on the tree at introduction: 0 of 152 link sites sat inside a comment, so this
 * changes no baseline credit — it only closes the fail-open (WIC-1560).
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ') // {/* JSX comment */}
    .replace(/\/\*[\s\S]*?\*\//g, ' ') //          /* block comment */
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1'); //  // line comment
}

function collectLinkSites(sources: Record<string, string>): LinkSite[] {
  const sites: LinkSite[] = [];

  for (const [file, rawSource] of Object.entries(sources)) {
    const source = stripComments(rawSource);
    for (const pattern of LINK_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const raw = match[1];
        sites.push({ file, raw, path: toConcretePathname(raw) });
      }
    }
  }

  return sites;
}

/**
 * The inverse join of the link -> route audit: which declared routes no link resolves to.
 *
 * A link is credited to the route `matchRoutes` actually picks for it, not to every route
 * it could conceivably match. That matters because React Router ranks by specificity, so
 * `/resumes/exports` is credited to the static route and `/resumes/x/exports` to the
 * parameterized one — using the same matcher as the forward assertion keeps the two
 * directions from disagreeing about what a link means.
 *
 * `KNOWN_DEAD_LINKS` is deliberately not consulted here, and cannot weaken this: an entry
 * on that list either still matches no route — in which case it credits nothing — or the
 * route has since been added, in which case the link is live and crediting it is right.
 *
 * Kept as a pure function of its three inputs so the capability check below can drive it
 * with a synthetic route table rather than re-implementing the join.
 */
function orphanRoutePaths(
  paths: string[],
  linkPathnames: string[],
  elementByPath: Record<string, string>
): string[] {
  const table = paths.map((path) => ({ path }));

  const linked = new Set(
    linkPathnames
      .map((pathname) => matchRoutes(table, pathname)?.at(-1)?.route.path)
      .filter((path): path is string => Boolean(path))
  );

  return paths.filter((path) => elementByPath[path] !== 'Navigate' && !linked.has(path));
}

// Every source file in the app, minus the tests themselves — this file lists dead paths
// in KNOWN_DEAD_LINKS and would otherwise flag its own documentation.
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const appSources = Object.fromEntries(
  Object.entries(sources).filter(
    ([file]) => !file.includes('/test/') && !/\.(test|spec)\.tsx?$/.test(file)
  )
);

const routePaths = declaredRoutePaths(appSource);
const routeElements = declaredRouteElements(appSource);
const routes = routePaths.map((path) => ({ path }));
const linkSites = collectLinkSites(appSources);

describe('in-app navigation targets', () => {
  // Guards against the extraction above silently breaking — a regex that stops matching
  // would otherwise turn the real assertion into a green no-op.
  it('extracts a plausible route table from App.tsx', () => {
    expect(routePaths.length).toBeGreaterThan(20);
    expect(routePaths).toContain('/');
    expect(routePaths).toContain('/applications');
  });

  it('extracts link targets from across the app', () => {
    expect(linkSites.length).toBeGreaterThan(20);
    expect(Object.keys(appSources).length).toBeGreaterThan(20);
  });

  // The failure mode this audit is most exposed to is becoming vacuous: a catch-all
  // route left in the match set makes every path "reachable" and the assertion below
  // can never fail again. This proves the matcher still says no to something.
  it('is capable of failing — an unrouted path matches nothing', () => {
    expect(matchRoutes(routes, '/definitely-not-a-route')).toBeNull();
  });

  it('has no link pointing at a path App.tsx does not route', () => {
    const dead = linkSites.filter(
      (site) =>
        !Object.hasOwn(KNOWN_DEAD_LINKS, site.raw) && matchRoutes(routes, site.path) === null
    );

    const report = dead.map((site) => `  ${site.raw}  (${site.file})`).join('\n');

    expect(
      dead,
      `These link targets match no route in App.tsx:\n${report}\n\n` +
        `Add the missing <Route>, fix the link, or — if it is a known defect owned by ` +
        `another ticket — add it to KNOWN_DEAD_LINKS with that ticket's number.`
    ).toEqual([]);
  });

  // The mirror of the "is capable of failing" test above, for the route -> link
  // direction. The join is driven with a synthetic route table so this proves the real
  // function reports an orphan, rather than asserting a parallel re-implementation of it.
  it('the orphan audit is capable of failing — an unlinked route is reported', () => {
    expect(
      orphanRoutePaths(['/linked', '/orphan'], ['/linked'], {
        '/linked': 'LinkedPage',
        '/orphan': 'OrphanPage',
      })
    ).toEqual(['/orphan']);
  });

  // Commenting the entry point out is the most common way a page becomes orphaned, and
  // the user-visible outcome is identical to deleting it. `collectLinkSites` regexes over
  // source, so it must not credit a route from a link that is commented out — otherwise
  // JSX-commenting the sole `<Link>` to a page silently reverts its entry point (the exact
  // regression WIC-1530 added a guard against) and this audit stays green. FO-B/FO-C.
  it('does not credit a route from a commented-out link', () => {
    const source = [
      '<Link to="/live">Live</Link>',
      '// <Link to="/line-commented">Gone</Link>',
      '{/* <Link to="/jsx-commented">Gone</Link> */}',
      '/* to="/block-commented" */',
      // A live link on a line that also contains a `://` URL: the line-comment guard must
      // not treat the `//` in `https://` as a comment and strip `/guarded` after it.
      'const api = "https://example.com"; go(<Link to="/guarded">G</Link>);',
    ].join('\n');

    const collected = collectLinkSites({ 'x.tsx': source }).map((site) => site.raw);

    expect(collected).not.toContain('/line-commented');
    expect(collected).not.toContain('/jsx-commented');
    expect(collected).not.toContain('/block-commented');
    // Live links survive, including the one guarded from the `https://` false positive.
    expect(collected.sort()).toEqual(['/guarded', '/live']);
  });

  it('credits a link to the route it resolves to, including parameterized ones', () => {
    expect(
      orphanRoutePaths(['/things', '/things/:id'], ['/things', '/things/x'], {
        '/things': 'ThingsList',
        '/things/:id': 'ThingDetail',
      })
    ).toEqual([]);

    // A link to the list must not be credited to the detail route just because the
    // matcher could have reached it — otherwise an orphan detail page reads as linked.
    expect(
      orphanRoutePaths(['/things', '/things/:id'], ['/things'], {
        '/things': 'ThingsList',
        '/things/:id': 'ThingDetail',
      })
    ).toEqual(['/things/:id']);
  });

  it('exempts <Navigate> routes, and only because App.tsx says <Navigate>', () => {
    // Derived, not hand-listed: these two are exempt because the source renders
    // `<Navigate>` there. Rewrite either to render a page and it stops being exempt.
    expect(routeElements['/dashboard']).toBe('Navigate');
    expect(routeElements['/reports/pipeline']).toBe('Navigate');
    expect(routeElements['/']).toBe('Dashboard');

    expect(orphanRoutePaths(['/redirect'], [], { '/redirect': 'Navigate' })).toEqual([]);
    expect(orphanRoutePaths(['/redirect'], [], { '/redirect': 'SomePage' })).toEqual(['/redirect']);
  });

  // Guards the element extraction the same way the route/link extraction is guarded: if
  // the regex stopped matching, every route would look like a non-`<Navigate>` route and
  // the exemption would silently vanish (noisy), or — worse — a rename could make
  // everything look exempt. Pin both the coverage and the shape.
  it('reads an element for every declared route', () => {
    const missing = routePaths.filter((path) => !routeElements[path]);
    expect(missing, `No element parsed for: ${missing.join(', ')}`).toEqual([]);

    const redirects = routePaths.filter((path) => routeElements[path] === 'Navigate');
    expect(redirects.length).toBeGreaterThan(0);
    expect(redirects.length).toBeLessThan(routePaths.length);
  });

  it('has no route without an inbound link', () => {
    const orphans = orphanRoutePaths(
      routePaths,
      linkSites.map((site) => site.path),
      routeElements
    );

    const report = orphans.map((path) => `  ${path}  (<${routeElements[path]} />)`).join('\n');

    expect(
      orphans,
      `These routes are declared in App.tsx but nothing in the app links to them:\n` +
        `${report}\n\n` +
        `A route no button reaches is a page no user can find. Add the entry point, or ` +
        `remove the route. There is deliberately no allowlist: the only exemption is a ` +
        `route whose element is <Navigate>, which is a redirect and is meant to absorb ` +
        `traffic the app does not generate.`
    ).toEqual([]);
  });
});
