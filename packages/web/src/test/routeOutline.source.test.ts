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
  it('Login.tsx emits the /login h1 itself', () => {
    // /login is the one route ProtectedRoute does not wrap, so nothing above it could
    // ever supply a heading. Before this fix the page opened at <h2>.
    expect(count(loginSource, H1)).toBe(1);
    expect(count(loginSource, H2)).toBe(0);
  });

  it('SavedFilterShortcuts.tsx emits no h1 — the /applications page keeps that', () => {
    // The forbidden fix, stated directly: this panel takes over the page's h1. It sits
    // under /applications' own <h1>Applications</h1>, so its own heading must be an h2.
    expect(count(savedFilterShortcutsSource, H1)).toBe(0);
    expect(count(savedFilterShortcutsSource, H2)).toBeGreaterThanOrEqual(1);

    // ...and the other way it can go wrong: deleting the panel heading instead of
    // demoting it. Then the outline is skip-free because the h3 is simply gone, and the
    // render sweep — which only reports *skips* and the opening level — would not notice.
    expect(count(savedFilterShortcutsSource, H3)).toBe(0);
  });

  it('ResumeVariantCard.tsx emits no h1, and its card heading is an h2', () => {
    expect(count(resumeVariantCardSource, H1)).toBe(0);
    expect(count(resumeVariantCardSource, H2)).toBe(1);
    expect(count(resumeVariantCardSource, H3)).toBe(0);
  });

  it('CatalogBrowseView.tsx owns the /catalog h1, and its cards are h2', () => {
    // The exception that proves the rule, and it is deliberate rather than an oversight:
    // `CatalogPage.tsx` is a one-line wrapper that renders this component and nothing
    // else, so this file *is* the page body and the route's single `<h1>` belongs here.
    // Pinning it at exactly 1 still forbids the failure mode the others guard against —
    // a second `<h1>` appearing when a card heading gets promoted too far.
    expect(count(catalogBrowseSource, H1)).toBe(1);
    expect(count(catalogBrowseSource, H2)).toBeGreaterThanOrEqual(1);
    expect(count(catalogBrowseSource, H3)).toBe(0);
  });
});
