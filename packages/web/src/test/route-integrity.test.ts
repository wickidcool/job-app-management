import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import rawAppSource from '../App.tsx?raw';

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
 * Source that has been through `stripComments`. Route scrapers below take this and
 * not `string`, so handing one the raw import is a compile error rather than a
 * silently over-broad route table. See WIC-1551.
 */
type StrippedSource = string & { readonly __commentsStripped: true };

/**
 * Remove JS/JSX comments from source, preserving newlines so line numbers survive.
 *
 * WIC-1551: the route scrapers below split on the literal `<Route`, and a commented-out
 * route still contains that literal — so a route declaration wrapped in a JSX comment
 * entered the route table as if it were live. That is green in both directions at once: a
 * genuinely dead link pointing at `/legacy` is absorbed by the phantom route, and the
 * phantom route is in turn credited by that link. Commenting out a route while leaving a
 * button pointing at it — an ordinary way to disable a feature — was invisible here.
 *
 * This is a character scanner rather than a regex, and that is load-bearing. `App.tsx`
 * declares `path="/*"` for its catch-all layout route: a *string literal* containing a
 * block-comment opener. The obvious regex that lazily matches an opener through to the
 * next closer opens a comment there and swallows everything up to the closer on the
 * `/dashboard` note below it — which today deletes the `/` (Dashboard) route from the
 * audit's own route table. An over-tightened stripper is
 * the more dangerous failure of the two: a noisy false positive gets fixed, whereas a
 * route table with live routes missing makes the audit quietly vacuous.
 *
 * The scanner only ever deletes comment content, so a mis-read quote *usually* under-strips.
 * Not always, and this is the correction that matters: a desync which closes *inside a
 * double-quoted string* consumes that string's opening quote, which shifts double-quote parity
 * for everything after it. `path="/*"` is then read as a bare comment opener rather than a
 * string, and the scanner deletes from there to the next closer. Two lines of ordinary JSX are
 * enough — `<p>Sarah's applications</p>` above `<div title="Don't panic" />`: the possessive
 * opens the window, the contraction closes it mid-attribute, and the route table goes from 30
 * entries to 29, losing `/`. Regex literals are not tracked either, and `App.tsx` contains
 * none. The route-table floor assertions below are what catch both, and they name `/`
 * specifically because `path="/*"` is the only in-string comment opener in the file and `/` is
 * the only route between it and the next closer — so an over-strip that starts at the hazard
 * cannot avoid dropping a route the assertion names.
 *
 * Under-stripping is the safe direction for route *loss*, but it is not harmless here,
 * because "leaving today's behaviour" is the bug this function exists to fix. The scanner
 * is not JSX-aware: a lone `'` in JSX text ("Don't") is not a string delimiter, but it is
 * read as one, which suspends comment detection until the *next* `'`. That is a bounded
 * window, not the rest of the file — anything inside it passes through verbatim, so a route
 * commented out in there is read as live, and this function is a no-op over that span.
 *
 * What makes that catchable is a structural property, not the fact that `App.tsx` happens to
 * contain three comment openers today: a route commented out in JSX-comment form carries its
 * own opener into the window with it, so the opener survives stripping exactly when the route
 * does. `strips every JSX comment opener out of the real App.tsx` below keys on that, which is
 * why it reds on the desync itself rather than on any particular file layout.
 */
function stripComments(source: string): StrippedSource {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const pair = source.slice(i, i + 2);

    if (pair === '//') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (pair === '/*') {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== '*/') {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }

    const char = source[i];

    // A quote suspends comment detection until it closes. This is what keeps
    // `path="/*"` from opening a comment that eats the routes after it.
    if (char === '"' || char === "'" || char === '`') {
      out += char;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        i += 1;
        if (source[i - 1] === char) break;
      }
      continue;
    }

    out += char;
    i += 1;
  }

  return out as StrippedSource;
}

/**
 * Every `path` declared on a `<Route>` in App.tsx.
 *
 * Catch-all patterns (`*`, `/*`) are dropped on purpose. They match every path by
 * definition, so leaving them in would make this audit vacuously pass — which is
 * exactly what would happen once the WIC-1036 catch-all 404 route lands.
 */
function declaredRoutePaths(source: StrippedSource): string[] {
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
    ([file]) => !file.includes('/test/') && !/\.(test|spec)\.tsx?$/.test(file)
  )
);

// Sanitised once, here, rather than inside each scraper. Every route scraper in this
// file consumes `appSource`, so a scraper added later (WIC-1531 adds a second one that
// mirrors this split to read each route's element) inherits the fix without having to
// remember it — and cannot take the raw source instead, because `StrippedSource` is the
// only type the scrapers accept.
const appSource = stripComments(rawAppSource);

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

  // WIC-1551. Both directions, because either one alone is satisfied by a broken
  // stripper: returning the source untouched passes the second cell, and returning an
  // empty string passes the first.
  describe('comment stripping (WIC-1551)', () => {
    it('does not admit a commented-out route into the route table', () => {
      const jsx = '{/* <Route path="/legacy" element={<LegacyPage />} /> */}';
      const block = '/* <Route path="/legacy" element={<LegacyPage />} /> */';
      const line = '// <Route path="/legacy" element={<LegacyPage />} />';

      expect(declaredRoutePaths(stripComments(jsx))).toEqual([]);
      expect(declaredRoutePaths(stripComments(block))).toEqual([]);
      expect(declaredRoutePaths(stripComments(line))).toEqual([]);
    });

    it('still finds a live route', () => {
      const live = '<Route path="/x" element={<X />} />';

      expect(declaredRoutePaths(stripComments(live))).toEqual(['/x']);
    });

    // The over-tightening direction, and the one that actually bites. `App.tsx` declares
    // `path="/*"` for its catch-all layout route, so the source contains a block-comment
    // opener *inside a string literal*. A regex stripper opens a comment there and eats
    // every route between it and the next closer — which is a real JSX comment further
    // down. The audit then still passes, with live routes silently missing from the
    // table, which is strictly worse than the bug being fixed here.
    it('does not treat a block-comment opener inside a string as a comment', () => {
      const fixture = [
        '<Route',
        '  path="/*"',
        '  element={',
        '    <Routes>',
        '      <Route path="/" element={<Dashboard />} />',
        '      {/* a note that closes the comment a regex stripper wrongly opened above */}',
        '      <Route path="/settings" element={<Settings />} />',
        '      {/* <Route path="/legacy" element={<Legacy />} /> */}',
        '      <Route path="*" element={<NotFound />} />',
        '    </Routes>',
        '  }',
        '/>',
      ].join('\n');

      expect(declaredRoutePaths(stripComments(fixture))).toEqual(['/', '/settings']);
    });

    it('leaves a comment-like sequence inside a string in place', () => {
      expect(stripComments('const a = "http://x/*y*/z";')).toBe('const a = "http://x/*y*/z";');
      expect(stripComments("const a = 'http://x';")).toBe("const a = 'http://x';");
    });

    it('strips a comment while keeping the code on either side', () => {
      expect(stripComments('a /* gone */ b')).toBe('a  b');
      expect(stripComments('a // gone\nb')).toBe('a \nb');
    });
  });

  // The real App.tsx, not a fixture: if the stripper over-strips against live source, the
  // route table loses entries and every downstream assertion goes quietly vacuous.
  // `/` is the route immediately after the `path="/*"` hazard and `/settings` is the last
  // one before the catch-all, so an over-strip starting at that hazard drops one of them.
  it('keeps every live route in App.tsx after stripping', () => {
    expect(routePaths.length).toBeGreaterThan(25);
    expect(routePaths).toContain('/');
    expect(routePaths).toContain('/settings');
    expect(routePaths).toContain('/applications/:id/prep');
  });

  // The under-strip direction, against real source. Every assertion above this one only
  // detects over-stripping; nothing detected the stripper quietly doing *nothing*, because
  // `App.tsx` has no commented-out route today and so a no-op stripper is green.
  //
  // The concrete way that happens: a lone `'` in JSX copy is not a string delimiter, but
  // the scanner treats it as one and suspends comment detection until the next `'`. Whatever
  // falls inside that window passes through verbatim. Measured — `<p>Don't forget to review</p>`
  // above a commented-out `<Route path="/legacy">`, plus a live link to `/legacy`, is 10
  // passed/10; changing only `Don't` to `Do not` reports the dead link. One apostrophe reopens
  // the exact defect this file exists to close, so it is pinned here rather than left in prose.
  //
  // This cell does not depend on where App.tsx's own comments sit. A route commented out in
  // JSX-comment form carries its own opener into the window, so the opener survives stripping
  // exactly when the route survives it — the route is its own tripwire.
  //
  // The anchor is `{/*` and not `/*` on purpose: `path="/*"` legitimately survives stripping
  // inside its string literal, which the cell above pins, so the broader pattern would fail
  // on the clean tree. Known limit: this catches a desync that swallows a JSX comment
  // opener — the shape that can carry a `<Route>` into the table — not one that swallows a
  // bare `//` line comment.
  it('strips every JSX comment opener out of the real App.tsx', () => {
    // Staleness control on the assertion below. `toBeNull()` is also satisfied by an
    // App.tsx with no JSX comments left to strip, at which point the canary would be
    // green forever while proving nothing. If this fails, the canary has gone vacuous
    // and needs re-pointing at whatever source still exercises the stripper.
    expect(
      rawAppSource.match(/\{\/\*/g),
      'App.tsx no longer contains a JSX comment, so the assertion below can no longer fail'
    ).not.toBeNull();

    expect(
      appSource.match(/\{\/\*/g),
      'stripComments left a JSX comment opener in App.tsx: comment detection desynced ' +
        'partway through the file (an apostrophe in JSX copy will do it), so any route ' +
        'commented out after that point is being read as live.'
    ).toBeNull();
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
