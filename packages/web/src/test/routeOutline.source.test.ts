import { describe, expect, it } from 'vitest';

import appSource from '../App.tsx?raw';
import bottomTabBarSource from '../components/BottomTabBar.tsx?raw';
import catalogBrowseSource from '../components/CatalogBrowse/CatalogBrowseView.tsx?raw';
import mobileNavigationSource from '../components/MobileNavigation.tsx?raw';
import protectedRouteSource from '../components/ProtectedRoute.tsx?raw';
import resumeVariantCardSource from '../components/ResumeVariantCard.tsx?raw';
import savedFilterShortcutsSource from '../components/SavedFilterShortcuts.tsx?raw';
import topNavigationSource from '../components/TopNavigation.tsx?raw';
import loginSource from '../pages/Login.tsx?raw';
import projectDetailSource from '../pages/ProjectDetail.tsx?raw';
import projectsListSource from '../pages/ProjectsList.tsx?raw';
import reportsClosedLoopSource from '../pages/ReportsClosedLoop.tsx?raw';
import reportsNeedsActionSource from '../pages/ReportsNeedsAction.tsx?raw';
import reportsStaleSource from '../pages/ReportsStale.tsx?raw';
import resumeManagerSource from '../pages/ResumeManager.tsx?raw';

/**
 * WIC-1675 AC-5 — the source half of the rendered-outline check.
 *
 * `routeOutline.render.test.tsx` asserts the shape of each route's outline. That alone
 * cannot tell a correct fix from a wrong one, and the wrong one is the tempting one: for
 * every "this route must open at h1" failure there are two ways to go green, and only
 * one of them is right.
 *
 *   ✅ the *page* emits the `<h1>`, and the shared component's heading stays an `<h2>`;
 *   ❌ the shared component's heading is promoted to `<h1>`.
 *
 * Both satisfy "the outline starts at 1". The second is wrong — a shared component must
 * not emit its host page's `<h1>` (`docs/design/COMPONENT_SPECS.md` §10: *"The page
 * `<h1>` names the route"*) — and it would also break every *other* route that mounts
 * the same component. So each fix is paired here with a guard naming the file that owns
 * the heading. A mechanism that certifies the wrong fix is not enforcement.
 */

/**
 * Strips comments so an `<h1` written in prose — including this file's own, and the
 * explanatory comments left next to each fix — cannot be counted as markup.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function count(source: string, tag: RegExp): number {
  return [...stripComments(source).matchAll(tag)].length;
}

const H1 = /<h1[\s>]/g;
const H2 = /<h2[\s>]/g;
const H3 = /<h3[\s>]/g;

describe('no ancestor supplies a route its h1 (the AC-3 premise, measured)', () => {
  /**
   * The render sweep mounts page components directly rather than through `App`, so it
   * cannot see a heading an ancestor would have supplied. That makes "the page must own
   * its `<h1>`" a *premise* of the whole check rather than something it proves.
   *
   * The premise is true, and this is where that is established rather than asserted in a
   * comment: there is no `Layout`/`Shell` component in this codebase, and the chrome that
   * does wrap every route contributes no heading at all. If someone later adds an `<h1>`
   * to the navigation, the render sweep would keep passing while every page's own `<h1>`
   * quietly became a second one — this is the test that catches that.
   */
  const chrome: Array<[string, string]> = [
    ['App.tsx', appSource],
    ['ProtectedRoute.tsx', protectedRouteSource],
    ['TopNavigation.tsx', topNavigationSource],
    ['MobileNavigation.tsx', mobileNavigationSource],
    ['BottomTabBar.tsx', bottomTabBarSource],
  ];

  it.each(chrome)('%s emits no heading of any level', (name, source) => {
    const stripped = stripComments(source);
    const headings = [...stripped.matchAll(/<h([1-6])[\s>]/g)].map((m) => m[1]);

    expect(headings, `${name} now renders a heading; the route outline premise is stale`).toEqual(
      []
    );
  });

  it('is reading real files, not empty strings', () => {
    // `?raw` on a path that does not exist is a build error, but a file that has been
    // emptied or renamed to a stub would make every assertion above pass vacuously.
    for (const [name, source] of chrome) {
      expect(source.length, `${name} looks empty`).toBeGreaterThan(200);
    }
  });
});

describe('each fix is owned by the file that should own it', () => {
  /**
   * Why these exist, and why they pin *exact* counts.
   *
   * The render sweep and these guards fail in different directions, and only together do
   * they cover both ways a heading fix can be undone:
   *
   *   - **demotion** (`h2` back to `h3`) reintroduces a skip, so the render sweep catches
   *     it on every one of these files, guarded or not;
   *   - **deletion** (the `<h2>` becomes a `<span>`, or goes away) is *invisible* to the
   *     render sweep. The outline still opens at one `<h1>`, still has no skip — it is
   *     skip-free precisely because the offending heading is gone — and one heading is
   *     far too few to move the ≥87 non-empty floor. It reads as a clean page.
   *
   * That gap was measured rather than reasoned about: replacing the row `<h2>` in
   * `ProjectsList.tsx` with a `<span>` left the suite at exactly 216/216 and `tsc -b` at
   * rc=0, while the identical deletion in `SavedFilterShortcuts.tsx` — which already had a
   * guard here — went red. It is the same hazard WIC-1586 ruled on one layer up: *"the
   * `<h2>` side can go to zero and the sweep silently stops enforcing anything."*
   *
   * The counts are exact rather than `>= 1` on purpose. A floor of one lets a file lose
   * headings silently wherever it has more than one — `ReportsStale` could drop its
   * empty-state `<h2>` and keep passing on the row `<h2>`. Four of these ten files pin a
   * single `h2`, where a floor would have been equally strong; pinning them exactly costs
   * nothing and keeps one rule instead of two. Exact counts make any heading leaving any
   * of these files a deliberate, visible edit here.
   *
   * The `h1` column is the AC-5 assertion proper: it names, per file, whether that file is
   * the one allowed to emit the route's `<h1>`. `h1: 0` on a shared component is what
   * forbids the tempting wrong fix of promoting its heading instead of adding one to the
   * page.
   */

  const guards: Array<{
    name: string;
    source: string;
    h1: number;
    h2: number;
    h3: number;
    note: string;
  }> = [
    {
      // /login is the one route ProtectedRoute does not wrap, so nothing above it could
      // ever supply a heading. Before this fix the page opened at h2.
      name: 'Login.tsx',
      source: loginSource,
      h1: 1,
      h2: 0,
      h3: 0,
      note: 'the page owns the /login h1 itself',
    },
    {
      // The forbidden fix, stated directly: this panel takes over the page's h1. It sits
      // under /applications' own h1 "Applications", so its own heading must be an h2.
      // The h3 pin catches the other way it can go wrong — deleting the panel heading
      // instead of demoting it, which the render sweep reads as a clean page.
      name: 'SavedFilterShortcuts.tsx',
      source: savedFilterShortcutsSource,
      h1: 0,
      h2: 1,
      h3: 0,
      note: 'the panel heading, demoted; /applications keeps the h1',
    },
    {
      name: 'ResumeVariantCard.tsx',
      source: resumeVariantCardSource,
      h1: 0,
      h2: 1,
      h3: 0,
      note: 'the card heading; the host page keeps the h1',
    },
    {
      // The exception that proves the rule, and it is deliberate rather than an oversight:
      // `CatalogPage.tsx` is a one-line wrapper that renders this component and nothing
      // else, so this file *is* the page body and the route's single h1 belongs here.
      // Pinning it at exactly 1 still forbids the failure mode the others guard against —
      // a second h1 appearing when a card heading gets promoted too far.
      name: 'CatalogBrowseView.tsx',
      source: catalogBrowseSource,
      h1: 1,
      h2: 1,
      h3: 0,
      note: 'the sole body of /catalog, so it owns the h1; its cards are h2',
    },
    {
      name: 'ProjectsList.tsx',
      source: projectsListSource,
      h1: 1,
      h2: 2,
      h3: 0,
      note: 'the project row card + the "Create New Project" panel',
    },
    {
      name: 'ProjectDetail.tsx',
      source: projectDetailSource,
      h1: 1,
      h2: 1,
      h3: 0,
      note: 'the file row card',
    },
    {
      name: 'ResumeManager.tsx',
      source: resumeManagerSource,
      h1: 1,
      h2: 1,
      h3: 0,
      note: 'the resume row card',
    },
    {
      name: 'ReportsStale.tsx',
      source: reportsStaleSource,
      h1: 1,
      h2: 2,
      h3: 0,
      note: 'the empty-state message + the report row',
    },
    {
      name: 'ReportsNeedsAction.tsx',
      source: reportsNeedsActionSource,
      h1: 1,
      h2: 2,
      h3: 0,
      note: 'the empty-state message + the report row',
    },
    {
      // The one file here that keeps an `<h3>`, and it is correct. Its card sub-component
      // renders inside a section `<h2>`, so `h1 -> h2 -> h3` is a legitimate outline and
      // the render sweep reports no skip for it. Only the empty-state heading was the
      // defect, and that is the `h3` -> `h2` this PR made. Pinning `h3` at 1 rather than 0
      // keeps the deletion guard without demanding a fix the page does not need.
      name: 'ReportsClosedLoop.tsx',
      source: reportsClosedLoopSource,
      h1: 1,
      h2: 5,
      h3: 1,
      note: 'the empty-state message + 4 section headings; its surviving h3 is the card under a section h2',
    },
  ];

  /**
   * What actually ran, recorded by the guards themselves.
   *
   * This is the input to the coverage check below, and it exists because the previous
   * revision's coverage check had no input at all: it measured the length of a
   * hand-written literal against the constant 10, so it was *anti-correlated* with the
   * thing it claimed to assert. Deleting a whole guard while leaving its name in the
   * literal passed (measured: 18 tests -> 17, nothing red), and removing a name while
   * leaving the guard intact failed. Recording each name from inside the guard body makes
   * the two directions impossible to separate: a guard that does not run cannot report
   * itself.
   *
   * Pushed on the first line, before any assertion, so a guard that runs and *fails*
   * still counts as covered — this measures coverage, not passing.
   */
  const executed: string[] = [];

  // Title carries no counts on purpose: vitest renders a 0 as `+0`, which reads as a
  // delta. The pinned values live in the table and in each assertion's message.
  it.each(guards)('$name — $note', ({ name, source, h1, h2, h3 }) => {
    executed.push(name);

    expect(count(source, H1), `${name}: this file must emit exactly ${h1} h1`).toBe(h1);
    expect(
      count(source, H2),
      `${name}: an h2 was deleted or promoted — the render sweep cannot see this`
    ).toBe(h2);
    expect(count(source, H3), `${name}: an h3 came back, or one was deleted`).toBe(h3);

    // `?raw` on a missing path is a build error, but a file emptied or reduced to a stub
    // would make every count above pass vacuously at zero.
    expect(source.length, `${name} looks empty`).toBeGreaterThan(200);
  });

  it('every guard in the table above actually ran, and the table is the full fixed set', () => {
    // Runs last by declaration order, so `executed` is complete by the time this reads it.
    //
    // Two failure directions, both real:
    //   - a guard deleted (or skipped) => `executed` is short => red here;
    //   - an entry added without its counts being real => it reds in its own guard above.
    //
    // The size pin is the third: WIC-1675 changed exactly ten production files, and every
    // one of them must appear. A future fix that lands without a guard has to edit this
    // number, which is the visible edit the old check failed to force.
    expect(executed.length, 'a guard was deleted or skipped').toBe(guards.length);
    expect([...executed].sort(), 'the guards that ran are not the table').toEqual(
      guards.map((g) => g.name).sort()
    );
    expect(
      new Set(executed).size,
      'the table must cover all ten files WIC-1675 changed, each exactly once'
    ).toBe(10);
  });
});
