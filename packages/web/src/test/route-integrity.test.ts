import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import appSource from '../App.tsx?raw';

/**
 * A static audit of in-app navigation: every internal path the UI can send a user to
 * must be matched by a concrete route in App.tsx.
 *
 * This exists because WIC-1032 shipped a "Go to Dashboard" button pointing at
 * `/dashboard`, which no route matched — the user landed on an empty content area.
 * Nothing in the type system or the linter can see that; only a run-time click could,
 * and clicking it in Playwright costs a dev server, an API and a database. Reading the
 * source and matching it against the route table costs nothing and runs in Lint & Test.
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

function collectLinkSites(sources: Record<string, string>): LinkSite[] {
  const sites: LinkSite[] = [];

  for (const [file, source] of Object.entries(sources)) {
    for (const pattern of LINK_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const raw = match[1];
        sites.push({ file, raw, path: toConcretePathname(raw) });
      }
    }
  }

  return sites;
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
    ([file]) =>
      // The glob is rooted at this file's own directory, so a sibling in `src/test/`
      // comes back as `./name.tsx` — Vite normalises `../test/name.tsx` away — and the
      // `/test/` check below never sees a `/test/` segment to match. Any non-`.test.`
      // helper living here was therefore scanned as application source. That was
      // invisible while `src/test/` held only `headingOutline.ts` and `prohibitedName.ts`
      // (neither contains a link-shaped string); `routeOutlineRoutes.tsx` carries the
      // concrete URLs the outline sweep mounts, including a deliberately unrouted one
      // for the `*` catch-all, and surfaced it. (WIC-1675)
      !/^\.\/[^/]+$/.test(file) && !file.includes('/test/') && !/\.(test|spec)\.tsx?$/.test(file)
  )
);

const routePaths = declaredRoutePaths(appSource);
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
});
