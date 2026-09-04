import { beforeAll, describe, expect, it, vi } from 'vitest';

import { describeOutline, findOutlineSkips, type OutlineEntry } from './headingOutline';
import { collectOutlines, stubGlobalFetch, type Branch } from './routeOutlineHarness';
import appSource from '../App.tsx?raw';

/**
 * WIC-1675 — the rendered heading outline of every route, on every render branch.
 *
 * Layer 2 of WIC-1483. Layer 1 (`eslint-plugin-jsx-a11y`, PR #226) closed the per-element
 * a11y rules and **cannot** close this one: the plugin has no `heading-order` rule, and
 * heading order is not a property of any single element, so a per-file lint is
 * structurally blind to it. Measured on the parent card: jsx-a11y would not have caught
 * any of the 16 defective pages.
 *
 * The class is compositional. `/cover-letters/new` (WIC-1571) is the canonical proof — the
 * page file had no heading, the child component had the `<h2>`, and **neither file was
 * defective on its own**. Only the assembled tree is. So this renders the tree.
 *
 * ## Both rules are now enforced unconditionally (WIC-2050)
 *
 * Two assertions, and as of this commit they are at the same strength:
 *
 *   - **No heading-level skip, on any route, on any branch.** No allowlist, no exemptions.
 *     This is closed and stays closed.
 *   - **Every route opens at a single `<h1>`.** Also closed. `MISSING_H1` below is now
 *     **empty**, so this holds over all 120 (route, branch) pairs with no exemptions.
 *
 * They used to be split, and the split was the honest reading at the time: the skips were
 * all one fix (a row or empty-state heading a level too deep), while the missing `<h1>`s
 * were a structural change to eleven pages' early returns. That work is done — the
 * inventory ran 25 -> 21 -> 0 — so the qualifier is gone from the rule.
 *
 * `MISSING_H1` is deliberately kept as an empty list rather than deleted, along with the
 * two staleness guards that now range over nothing. They are hazard-keyed, and the hazard
 * set is empty; what earns their keep is the size pin, which is now pinned at **zero** and
 * so makes re-opening the allowlist an edit someone has to make on purpose and defend.
 */

vi.mock('../services/api', async (importOriginal) =>
  (await import('./routeOutlineApiMock')).apiMockModule(
    (await importOriginal()) as Record<string, unknown>
  )
);

const { ROUTES } = await import('./routeOutlineRoutes');

stubGlobalFetch();

/** `${path}|${branch}` for a (route, branch) pair. */
function key(path: string, branch: Branch): string {
  return `${path}|${branch}`;
}

/**
 * The routes/branches that render no `<h1>` of their own, as measured on this tree.
 *
 * **Empty as of WIC-2050 — every one of the 120 pairs now opens at a single `<h1>`.**
 *
 * This was an inventory of open work, never a set of exemptions on the merits: every
 * entry was a real WCAG 2.1 AA (SC 1.3.1) defect and none of them was "fine". It existed
 * so the *skip* rule above could be enforced unconditionally without waiting on an
 * eleven-page structural change. That change has landed, so the list is empty and the
 * `<h1>` rule below is unconditional too.
 *
 * Two properties kept it from rotting into a permanent hole, and both are still asserted:
 *
 *   - it can only shrink — an entry that is no longer defective **fails**, so a fix
 *     cannot land without deleting its line;
 *   - its size is pinned, so entries cannot be added quietly to make a new defect pass.
 *
 * The second one is what still does work now that the first ranges over nothing: the pin
 * is at zero, so re-opening the allowlist means editing that number, which is exactly the
 * deliberate, reviewable edit the ratchet was built to force.
 *
 * Every entry was one of two shapes, and both had the same fix. Fifteen were pages whose
 * `<h1>` sat below an `isLoading` / `isError` early return, so those branches returned
 * with no heading at all. Four more (`/projects`, `/projects/:projectId`, its file editor)
 * stood a grey skeleton block where the heading goes — a heading is static copy, or comes
 * off the URL, so there was never a response to wait for. The two `/applications/:id/prep`
 * data branches were the odd shape: the page opened at its own `<h2>`. The fix in every
 * case is to render the heading above the early returns, as `CoverLetterNew` does; where
 * the heading is dynamic and genuinely unavailable, the branch shows the same
 * `DYNAMIC_TITLE_FALLBACKS` string the tab does, per `ROUTE_TITLE_CONVENTION.md` §0.3.
 */
const MISSING_H1: readonly string[] = [];

/**
 * Routes declared in `App.tsx` that this sweep does not mount, and why.
 *
 * Stated as data rather than left implicit: the completeness check below subtracts
 * exactly this set, so adding a route to it is a visible edit rather than a silent
 * narrowing of what gets measured.
 */
const NOT_A_RENDERED_ROUTE: Record<string, string> = {
  '/*': 'the ProtectedRoute wrapper, not a page',
  '/dashboard': 'a <Navigate> to /, renders no page',
  '/reports/pipeline': 'a <Navigate> to /applications, renders no page',
};

/** Every heading level in document order, e.g. `h1 -> h3 -> h2`. */
function levels(outline: OutlineEntry[]): string {
  return outline.map((h) => `h${h.level}`).join(' -> ');
}

describe('the route table is the whole route table', () => {
  // Without this, the sweep silently stops covering any route added to the app after
  // today. A per-route check that no longer runs is indistinguishable from one that
  // passes, and the count assertions below cannot tell the difference either — they
  // would simply be regenerated to the smaller number.

  const declared = [...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);

  it('finds the routes in App.tsx at all (guards the regex against matching nothing)', () => {
    expect(declared.length).toBeGreaterThan(25);
    expect(declared).toContain('/settings');
    expect(declared).toContain('/projects/:projectId/files/:fileName');
  });

  it('mounts every route App.tsx declares, except the non-rendering ones', () => {
    const expected = declared.filter((path) => !(path in NOT_A_RENDERED_ROUTE)).sort();
    const covered = ROUTES.map((route) => route.pattern ?? route.path).sort();

    expect(covered).toEqual(expected);
  });

  it('leaves no exclusion unexplained', () => {
    for (const [path, reason] of Object.entries(NOT_A_RENDERED_ROUTE)) {
      expect(declared, `${path} is excluded but no longer declared in App.tsx`).toContain(path);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

describe('every route renders a clean heading outline on every branch', () => {
  /**
   * The whole sweep, measured once.
   *
   * One `it` rather than `it.each` per route because the branches share a mounted
   * document body, and because the coverage counts below have to be taken from the same
   * pass that produced the verdicts — a count computed separately could agree with a
   * sweep that measured something else.
   */
  const measured: Array<{ path: string; branch: Branch; outline: OutlineEntry[] }> = [];

  beforeAll(async () => {
    for (const route of ROUTES) {
      for (const { branch, outline } of await collectOutlines(route.render, route)) {
        measured.push({ path: route.path, branch, outline });
      }
    }
  }, 120_000);

  /**
   * Every assertion below reports a defect by returning a **non-empty** list, so every
   * one of them passes over an empty `measured`. Collection happens once in `beforeAll`,
   * which means a single failure there would otherwise turn this whole file green.
   * Asserting the expected volume first makes that failure loud in each test instead.
   */
  function pairs() {
    expect(ROUTES).toHaveLength(30);
    expect(measured, 'the sweep did not render every (route, branch) pair').toHaveLength(120);
    return measured;
  }

  it('renders all four branches of all 30 routes', () => {
    // AC-4: coverage is a number, not an impression. If a route stops rendering, or a
    // branch stops being reachable, this is what says so — the per-pair assertions below
    // would all still pass over the smaller set.
    expect(pairs()).toHaveLength(120);
  });

  it('renders a non-empty outline on at least three quarters of the pairs', () => {
    // A blunt guard on the harness itself, not on the app. Every assertion in this file
    // is satisfied by a page that renders *nothing*: an empty outline has no skip, no
    // second h1 and no wrong opening level. If the API mock or the provider stack breaks,
    // the sweep goes quiet rather than red, so the volume of what it saw is pinned too.
    const withHeadings = pairs().filter((m) => m.outline.length > 0);
    expect(withHeadings.length).toBeGreaterThanOrEqual(90);
  });

  it('skips no heading level, on any route, on any branch', () => {
    // Unconditional. This is the WIC-1483 defect proper, and it is closed.
    const offenders = pairs()
      .map((m) => ({ ...m, skips: findOutlineSkips(m.outline) }))
      .filter((m) => m.skips.length > 0)
      .map((m) => `${m.path} (${m.branch}): ${describeOutline(m.outline)}`);

    expect(offenders).toEqual([]);
  });

  it('opens at exactly one h1, except on the pairs inventoried in MISSING_H1', () => {
    const offenders = pairs()
      .filter((m) => !MISSING_H1.includes(key(m.path, m.branch)))
      .filter((m) => {
        const h1s = m.outline.filter((h) => h.level === 1).length;
        return h1s !== 1 || m.outline[0]?.level !== 1;
      })
      .map((m) => `${m.path} (${m.branch}): ${levels(m.outline)} — ${describeOutline(m.outline)}`);

    expect(offenders).toEqual([]);
  });

  it('has no stale MISSING_H1 entry — a fixed pair must be deleted from the list', () => {
    // The direction that matters. An allowlist with no staleness test becomes permanent:
    // the fix lands, the entry stays, and the pair is never enforced again. This makes
    // fixing a page *fail* until its line is removed.
    const all = pairs();
    const fixed = MISSING_H1.filter((entry) => {
      const found = all.find((m) => key(m.path, m.branch) === entry);
      if (!found) return false; // covered by the coverage assertion below, not here
      return (
        found.outline.filter((h) => h.level === 1).length === 1 && found.outline[0].level === 1
      );
    });

    expect(fixed, 'these pairs now render a correct h1 — delete them from MISSING_H1').toEqual([]);
  });

  it('has no MISSING_H1 entry naming a pair the sweep does not measure', () => {
    const all = pairs();
    const unmatched = MISSING_H1.filter(
      (entry) => !all.some((m) => key(m.path, m.branch) === entry)
    );

    expect(unmatched, 'these entries match no rendered (route, branch) pair').toEqual([]);
  });

  it('pins the size of the inventory so entries cannot be added quietly', () => {
    // Paired with the staleness test above, this makes the list a one-way ratchet: it can
    // only get smaller, and only by someone editing this number down deliberately.
    //
    // It is now at the bottom of that ratchet. Zero is not a milestone to celebrate in a
    // comment, it is the assertion that does the work: with the list empty, the `<h1>`
    // rule above ranges over all 120 pairs with no exemptions, and the only way to carve
    // one back out is to edit this line — which is a reviewable act, not an oversight.
    expect(MISSING_H1).toHaveLength(0);
    expect(new Set(MISSING_H1).size, 'duplicate entry in MISSING_H1').toBe(MISSING_H1.length);
  });
});
