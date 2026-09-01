import { describe, expect, it } from 'vitest';

/**
 * The WIC-1581 ruling, as a regression guard.
 *
 * `docs/design/ROUTE_HEADING_OUTLINE.md` §0: a component that is the sole body of a
 * route must not render a heading that names the route. Two routes shipped that way —
 * `/outreach/new` and `/resumes/exports` — each rendering the same string as the page
 * `<h1>` and again as the panel's `<h2>` directly beneath it.
 *
 * This is a *source* sweep rather than a render test on purpose. The rule is about a
 * relationship between two files (a page and the component it mounts), so no single
 * rendered route can check it, and rendering all 29 routes to catch the next one would
 * cost far more than reading them. The same trick as `NotFound.test.tsx`'s
 * `App.tsx?raw` import, widened.
 *
 * It only sees *static* heading text. A heading built from an expression is invisible
 * here, and that blind spot is wider than "an edge case": measured on `6911bcb`,
 * 11 of 33 `<h1>` (33%) and 11 of 42 `<h2>` (26%) are already invisible — `{variant.title}`,
 * `{application.jobTitle}`, the `{title}` prop in `ConfirmationModal`/`OnboardingStep`/
 * `WizardStep`, and `WizardContainer`'s `{variant === 'create' && 'New Project'}`. The modal
 * and wizard titles are exactly where a route-naming duplicate would come from, so read a
 * green run as "no *literal* collision", not as "no collision". Both real defects were
 * literals; the next one need not be. (WIC-1586)
 *
 * It also reads JSX comments as live code, so commenting a heading out does not clear a
 * collision — fail-noisy, not fail-open, but it means "comment it out" is not a valid fix.
 */

const sources = import.meta.glob('../{pages,components}/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Static text of every `<hN>…</hN>` in a file, by level. Skips interpolated headings. */
function staticHeadings(src: string, level: 1 | 2): string[] {
  const re = new RegExp(`<h${level}\\b[^>]*>\\s*([^<>{}]+?)\\s*</h${level}>`, 'gs');
  return [...src.matchAll(re)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Resolve a relative import specifier against the importing file's glob key. */
function resolveImport(fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const segments = fromPath.split('/').slice(0, -1).concat(specifier.split('/'));
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    // Glob keys are themselves relative ('../components/Foo.tsx'), so a leading '..'
    // has nothing to pop and must survive into the result, or every resolution
    // misses by one directory and the whole check silently reports "unrelated".
    if (segment === '..' && resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  const base = resolved.join('/');
  return [`${base}.tsx`, `${base}/index.tsx`].find((candidate) => candidate in sources);
}

/** Every file reachable from `entry` by relative import, transitively, including itself. */
const reachableCache = new Map<string, Set<string>>();
function reachableFrom(entry: string): Set<string> {
  const cached = reachableCache.get(entry);
  if (cached) return cached;

  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const src = sources[current];
    if (!src) continue;
    for (const match of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const target = resolveImport(current, match[1]);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  reachableCache.set(entry, seen);
  return seen;
}

/**
 * Whether two files can appear on screen at once — the same file, or one mounting
 * the other at any depth. See the mount-site test at the bottom of this file for
 * why the heading intersection needs this and what it does not cover.
 */
function sharesARenderTree(a: string, b: string): boolean {
  return a === b || reachableFrom(a).has(b) || reachableFrom(b).has(a);
}

describe('route heading outline (WIC-1581)', () => {
  const files = Object.entries(sources).filter(([path]) => !path.includes('.test.'));

  it('finds headings to check at all (guards the glob against silently matching nothing)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap(([, src]) => staticHeadings(src, 1)).length).toBeGreaterThan(10);

    // Both halves, or the check below is a no-op. The collision is an intersection, so it
    // goes vacuously empty if EITHER side dries up — and the side that carries the defect
    // is <h2>, which counting <h1> alone does not pin. Measured on 6911bcb: 22 static
    // <h1> and 31 static <h2>.
    expect(files.flatMap(([, src]) => staticHeadings(src, 2)).length).toBeGreaterThan(10);

    // Both directories, for the same reason: a glob narrowed to pages/ still passes the
    // file-count and <h1> assertions above while dropping every component <h2>.
    for (const dir of ['/pages/', '/components/']) {
      expect(files.filter(([p]) => p.includes(dir)).length).toBeGreaterThan(5);
    }
  });

  it('renders no string as both an <h1> and an <h2>', () => {
    const h1: Record<string, string[]> = {};
    const h2: Record<string, string[]> = {};

    for (const [path, src] of files) {
      for (const [level, bucket] of [
        [1, h1],
        [2, h2],
      ] as const) {
        for (const text of staticHeadings(src, level)) {
          (bucket[text] ??= []).push(path);
        }
      }
    }

    const collisions = Object.keys(h1)
      .filter((text) => text in h2)
      .flatMap((text) =>
        h1[text].flatMap((h1Path) =>
          h2[text]
            .filter((h2Path) => sharesARenderTree(h1Path, h2Path))
            .map((h2Path) => `${JSON.stringify(text)} — h1 in ${h1Path}; h2 in ${h2Path}`)
        )
      );

    // A page <h1> and a component <h2> sharing a string is the WIC-1581 defect: the
    // panel names the route the page has already named. Give the panel's sections the
    // <h2> instead, or — if the slot carries its own meaning, as the cover-letter
    // wizard's step bar does — give it copy for that meaning. See §4 of the ruling.
    expect(collisions).toEqual([]);
  });

  /**
   * The mount-site half of §1.1's method, which the raw intersection above left out.
   *
   * The ruling in §0 is about *one* route: "a component that is the sole body of a
   * route must not render a heading that names the route." Two files that never
   * appear on screen together cannot commit it — no reader ever hears the string
   * twice, and there is no outline in which it sits at two levels. §1.1 says so in
   * its own method statement: "intersect the static heading strings, **then check
   * the mount site**." Only the first half had been implemented, so the sweep also
   * reported cross-route pairs, which are not defects and whose only available
   * "fix" is to make one of the two headings worse.
   *
   * First live instance, and the reason this exists (WIC-1533): `/cover-letters`
   * names itself `<h1>Cover Letters</h1>`, and `/applications/:id` — whose own
   * `<h1>` is the interpolated `{application.jobTitle}` — has an
   * `<h2>Cover Letters</h2>` section listing that application's letters, beside
   * `Details`, `Timeline`, `Job Description` and `Documents`. Neither page mounts
   * the other. Renaming either one would be contorting correct copy around a check
   * that does not apply to it.
   *
   * Both WIC-1581 defects remain caught: `OutreachNew` imports `OutreachComposer`
   * and `ResumeExports` imports `ResumeExportList`, so each pair shares a render
   * tree and still reports. Reintroducing either heading reds this file — measured,
   * not assumed.
   *
   * The walk is transitive, so a page → panel → sub-panel duplicate is caught too.
   * It inherits the sweep's existing blind spots (static text only, JSX comments read
   * as live) and adds one: a component reached through a barrel file or a dynamic
   * import is not linked here, so such a pair would go unreported.
   */
  it('still catches a duplicate between a page and the component it mounts', () => {
    const [outreachPage] = files.find(([p]) => p.endsWith('/OutreachNew.tsx'))!;
    const [outreachPanel] = files.find(([p]) => p.endsWith('/OutreachComposer.tsx'))!;
    const [applicationDetail] = files.find(([p]) => p.endsWith('/ApplicationDetail.tsx'))!;
    const [coverLettersList] = files.find(([p]) => p.endsWith('/CoverLettersList.tsx'))!;

    // The shape the ruling forbids: the page mounts the component.
    expect(sharesARenderTree(outreachPage, outreachPanel)).toBe(true);
    expect(sharesARenderTree(outreachPanel, outreachPage)).toBe(true);
    // A file against itself — an h1 and h2 in one component are always the same tree.
    expect(sharesARenderTree(outreachPage, outreachPage)).toBe(true);
    // The shape it does not: two routes that never render together.
    expect(sharesARenderTree(coverLettersList, applicationDetail)).toBe(false);
  });
});
