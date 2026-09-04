import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import rawAppSource from '../App.tsx?raw';

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
// It is EMPTY, and that is the intended steady state. WIC-1213 emptied it when PRs #82
// and #87 merged: all four original entries had gone dead at once, in two different
// ways — `/dashboard` and `/resumes/${resume.id}/exports` became genuinely routed, and
// the `/applications/${id}/prep/practice` and `/resume-manager` link sites were deleted
// outright. A dead entry is not merely untidy: it keeps suppressing its target forever,
// so re-breaking that exact link is undetectable. Dropping the parameterized exports
// route from App.tsx was measured green against the whole web suite while its entry was
// still here, and red the moment it went.
//
// The original comment here argued against a staleness check, on the grounds that it
// would start failing on main the moment an owning PR merged. That is precisely the
// signal wanted — it fires on the ticket that can act on it, in the close-out window,
// which is the only time the entry is cheap to remove. `has no stale entries` below is
// that check.
const KNOWN_DEAD_LINKS: Record<string, string> = {};

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
 * none.
 *
 * ⚠️ The route-table floor assertions below no longer catch the over-strip, and the rationale
 * that used to sit here — that `path="/*"` is the only in-string comment opener and `/` the only
 * route between it and the next closer, so an over-strip "cannot avoid dropping a route the
 * assertion names" — is **retracted**. It was true when written and `App.tsx` moved underneath
 * it: WIC-1089 inserted a one-line JSX comment ("Renders nothing; applies the route table's
 * document.title") at App.tsx:91, between the hazard at line 87 and the first `<Route path="/">`.
 * Its closer now ends the over-strip window at line 91, and that window contains no `<Route>`.
 * Measured on `1463eccc` with quote suspension removed outright: the route table is **identical**
 * — 31 entries, `/` and `/settings` both present — so both floor assertions stay green against a
 * scanner with no string handling whatsoever. Their discriminating power was an accident of file
 * layout, and an ordinary comment two lines long silently spent it.
 *
 * What guards the over-strip instead is the pair below that does not depend on layout: the
 * `does not treat a block-comment opener inside a string as a comment` fixture, and
 * `keeps the path="/*" string literal intact in the real App.tsx`, which asserts the hazard
 * itself survives stripping rather than asserting a downstream consequence of it surviving.
 * Prefer that shape here — a control keyed on the hazard cannot be disarmed by an edit that
 * merely moves what follows the hazard.
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
    //
    // WIC-1724: `'` is exempt when it is welded to the end of a word, because there it is
    // an apostrophe in JSX prose (`Don't`, `Sarah's`) and not a string opener. Without the
    // exemption the scanner opens a string that never closes in that role, and everything
    // after it passes through verbatim — the stripper silently becomes a no-op, which is
    // WIC-1551's defect reopened by a character of ordinary English. Measured on the tree
    // at `1463eccc`: adding `<p>Don't forget to review</p>` to App.tsx and changing nothing
    // else reds `strips every JSX comment opener out of the real App.tsx`.
    //
    // The test is the IMMEDIATELY preceding character, NOT the preceding non-whitespace
    // one, and the difference is load-bearing in the dangerous direction. `return 'x'` and
    // `case 'x':` are real string literals whose nearest non-whitespace neighbour is a
    // letter, so the whitespace-skipping form would stop suspending on them — and a `/*`
    // inside such a string would then open a comment and eat the routes after it, which is
    // the over-strip class WIC-1551 established is the worse of the two. A quote welded
    // directly to an identifier or digit with no separator is not valid JS/JSX, so the
    // narrow test has no corresponding false positive. `keeps a single-quoted string that
    // follows a keyword intact` below pins exactly this.
    //
    // Residual, unchanged and in the safe direction: a word-INITIAL apostrophe in prose
    // (`'tis`) is preceded by whitespace and still suspends, exactly as today.
    const isProseApostrophe = char === "'" && i > 0 && /[A-Za-z0-9]/.test(source[i - 1]);

    if ((char === '"' || char === "'" || char === '`') && !isProseApostrophe) {
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
 * Uses the same character-scanning `stripComments` the route table above does (WIC-1551) —
 * not a second, regex-based stripper. The regex this used to be had the identical
 * string-literal hazard the doc comment on `stripComments` describes for `App.tsx`'s
 * `path="/*"`: any file with a comment-opener-shaped substring inside a string literal
 * would over-strip past it. Measured on the tree at introduction: 0 of 152 link sites sat
 * inside a comment, so unifying on one stripper changes no baseline credit — it only closes
 * the fail-open (WIC-1560) without reintroducing the over-strip class WIC-1551 exists to fix.
 */
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

// Sanitised once, here, rather than inside each scraper. Every route scraper in this
// file consumes `appSource`, so a scraper added later (WIC-1531 adds a second one that
// mirrors this split to read each route's element) inherits the fix without having to
// remember it — and cannot take the raw source instead, because `StrippedSource` is the
// only type the scrapers accept.
const appSource = stripComments(rawAppSource);

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

  // WIC-1724. An apostrophe in JSX copy used to be read as a string opener, which
  // suspended comment detection for the rest of the file — so every route commented out
  // below it re-entered the route table. Both directions again, because either alone is
  // satisfied by a broken scanner: dropping the `'` branch entirely passes the first pair
  // and reds the second, and the unfixed scanner does the reverse.
  describe('apostrophes in JSX prose (WIC-1724)', () => {
    // AC-1: the headline scenario. Prose apostrophe above a commented-out route.
    it('does not let an apostrophe in JSX copy revive a commented-out route', () => {
      const source = [
        "<p>Don't forget to review</p>",
        '{/* <Route path="/legacy" element={<Legacy />} /> */}',
        '<Route path="/live" element={<Live />} />',
      ].join('\n');

      expect(declaredRoutePaths(stripComments(source))).toEqual(['/live']);
    });

    // The possessive/contraction pair from the WIC-1551 doc comment, which is the two-line
    // sequence that shifts quote parity for the whole rest of the file.
    it('survives a possessive and a contraction straddling an attribute', () => {
      const source = [
        "<p>Sarah's applications</p>",
        '<div title="Don\'t panic" />',
        '{/* <Route path="/legacy" element={<Legacy />} /> */}',
        '<Route path="/" element={<Dashboard />} />',
      ].join('\n');

      expect(declaredRoutePaths(stripComments(source))).toEqual(['/']);
    });

    // AC-2 / the over-strip guard. These are real single-quoted strings, and each must
    // still suspend comment detection or a `/*` inside one opens a comment.
    it('still treats a real single-quoted string as a delimiter', () => {
      expect(stripComments("const a = 'http://x/*y*/z';")).toBe("const a = 'http://x/*y*/z';");
      expect(stripComments("navigate('/x/*y*/z');")).toBe("navigate('/x/*y*/z');");
      expect(stripComments("{ path: '/x/*y*/z' }")).toBe("{ path: '/x/*y*/z' }");
    });

    // The specific reason this keys on the IMMEDIATELY preceding character rather than the
    // preceding non-whitespace one. Both of these are ordinary string literals whose
    // nearest non-whitespace neighbour is a letter, so the whitespace-skipping heuristic
    // would misread them as prose, stop suspending, and open a comment at the `/*` inside.
    // That is the over-strip direction — routes vanish and the audit goes quietly vacuous.
    it('keeps a single-quoted string that follows a keyword intact', () => {
      expect(stripComments("return 'http://x/*y*/z';")).toBe("return 'http://x/*y*/z';");
      expect(stripComments("case '/x/*y*/z':")).toBe("case '/x/*y*/z':");
      expect(stripComments("typeof 'a/*b*/c'")).toBe("typeof 'a/*b*/c'");
    });
  });

  // The real App.tsx, not a fixture. This is a floor on the route table — it catches the
  // table collapsing for any reason, which is worth keeping.
  //
  // ⚠️ It is NOT an over-strip control, despite what this comment used to claim. See the
  // retraction on `stripComments`: WIC-1089's comment at App.tsx:91 closes the over-strip
  // window before the first `<Route>`, so removing quote suspension outright leaves this
  // assertion — and every route path it names — completely unchanged. Do not cite it as the
  // thing standing between this file and a vacuous audit; the test directly below is.
  it('keeps every live route in App.tsx after stripping', () => {
    expect(routePaths.length).toBeGreaterThan(25);
    expect(routePaths).toContain('/');
    expect(routePaths).toContain('/settings');
    expect(routePaths).toContain('/applications/:id/prep');
  });

  // The over-strip control against real source, keyed on the hazard itself rather than on a
  // downstream consequence of it (WIC-1724).
  //
  // `path="/*"` is a string literal containing a block-comment opener. A scanner that fails
  // to suspend on `"` reads it as a bare opener and deletes from there to the next closer,
  // consuming the literal along the way — so the literal surviving stripping verbatim is a
  // direct assertion that quote suspension is working. Unlike the route-table floor above,
  // nothing about where the next `*/` happens to sit, or which routes happen to fall between
  // the two, can weaken it: the evidence and the hazard are the same characters.
  //
  // Measured on `1463eccc`: present with the scanner intact, absent with quote suspension
  // removed. If App.tsx ever stops declaring a catch-all this way, replace the anchor rather
  // than deleting the test — an over-strip control that no longer has a hazard to key on is
  // the vacuous state this exists to prevent.
  it('keeps the path="/*" string literal intact in the real App.tsx', () => {
    expect(rawAppSource).toContain('path="/*"');
    expect(appSource).toContain('path="/*"');
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

  // An allowlist with no staleness check degrades into permanent tree-wide holes: the
  // entry outlives the defect and then suppresses the *next* break of the same link.
  // An entry earns its place only while BOTH halves hold — the link site still exists,
  // and it still matches no route. Either half failing means the owning ticket landed.
  //
  // What this does NOT close, measured: re-adding an entry at the same time as breaking
  // its target is still green, because such an entry is accurately live. That case is a
  // deliberate two-step act, and the only thing standing against it is the rule above
  // that every entry names the ticket that owns removing it. The hole this closes is the
  // passive one — an entry going dead on its own and nobody noticing.
  it('has no stale entries in KNOWN_DEAD_LINKS', () => {
    const stale = Object.keys(KNOWN_DEAD_LINKS).flatMap((raw) => {
      const sites = linkSites.filter((site) => site.raw === raw);
      if (sites.length === 0) return [`${raw} — no link site authors this target any more`];
      if (matchRoutes(routes, sites[0].path) !== null)
        return [`${raw} — now matches a route in App.tsx`];
      return [];
    });

    expect(
      stale,
      `These KNOWN_DEAD_LINKS entries are dead and must be deleted:\n` +
        `${stale.map((s) => `  ${s}`).join('\n')}\n\n` +
        `Leaving them in re-permits the exact link their own ticket fixed.`
    ).toEqual([]);
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
