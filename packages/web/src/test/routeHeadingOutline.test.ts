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
 * here, which is the known limit — the two real defects were both literals, and a
 * literal is what the next one will be too.
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

describe('route heading outline (WIC-1581)', () => {
  const files = Object.entries(sources).filter(([path]) => !path.includes('.test.'));

  it('finds headings to check at all (guards the glob against silently matching nothing)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap(([, src]) => staticHeadings(src, 1)).length).toBeGreaterThan(10);
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
      .map(
        (text) =>
          `${JSON.stringify(text)} — h1 in ${h1[text].join(', ')}; h2 in ${h2[text].join(', ')}`
      );

    // A page <h1> and a component <h2> sharing a string is the WIC-1581 defect: the
    // panel names the route the page has already named. Give the panel's sections the
    // <h2> instead, or — if the slot carries its own meaning, as the cover-letter
    // wizard's step bar does — give it copy for that meaning. See §4 of the ruling.
    expect(collisions).toEqual([]);
  });
});
