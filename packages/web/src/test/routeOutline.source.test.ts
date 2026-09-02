import { describe, expect, it } from 'vitest';

import appSource from '../App.tsx?raw';
import bottomTabBarSource from '../components/BottomTabBar.tsx?raw';
import catalogBrowseSource from '../components/CatalogBrowse/CatalogBrowseView.tsx?raw';
import mobileNavigationSource from '../components/MobileNavigation.tsx?raw';
import protectedRouteSource from '../components/ProtectedRoute.tsx?raw';
import resumeVariantCardSource from '../components/ResumeVariantCard.tsx?raw';
import savedFilterShortcutsSource from '../components/SavedFilterShortcuts.tsx?raw';
import topNavigationSource from '../components/TopNavigation.tsx?raw';
import wizardContainerSource from '../components/wizard/WizardContainer.tsx?raw';
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
const H3 = /<h3[\s>]/g;

/**
 * Level 2 has two spellings in this codebase, and both are real `<h2>` elements.
 *
 * A Radix `Dialog.Title` renders an `<h2>` unless it is given `asChild` — asserted
 * directly rather than taken from the docs, in the `Dialog.Title` case below. Counting
 * only the literal tag would have made this guard lie: WIC-1141 (#97) converted
 * `ProjectsList`'s "Create New Project" panel heading from `<h2>` to `<Dialog.Title>` on
 * `main` while this branch was open. That is a *rename*, not a deletion — the heading is
 * still rendered at level 2 — but a literal-tag count reads it as the page losing a
 * heading, and the merge is textually clean, so nothing else would have flagged it.
 *
 * This matters more here than the arithmetic suggests: the heading now lives behind a
 * dialog, which is *user* state, so the render sweep (which varies only data state) never
 * opens it. For that one heading this source guard is the only coverage there is.
 *
 * `asChild` is the exception, and it is not a detail: it makes Radix render the *child*
 * instead of its own `<h2>`. `WizardContainer` uses exactly that to be both the dialog
 * title and its route's `<h1>`. So a bare `Dialog.Title` counts as a level-2 heading and
 * an `asChild` one contributes nothing of its own — the child is already counted by the
 * literal-tag pass, and counting both would double it.
 */
const H2_LITERAL = /<h2[\s>]/g;
const DIALOG_TITLE_ANY = /<Dialog\.Title[\s>]/g;
const DIALOG_TITLE_BARE = /<Dialog\.Title(?![^>]*\basChild\b)[\s>]/g;

function countH2(source: string): number {
  return count(source, H2_LITERAL) + count(source, DIALOG_TITLE_BARE);
}

describe('countH2 treats Dialog.Title as an h2 because Radix renders one (measured)', () => {
  /**
   * `countH2` is only honest if a `<Dialog.Title>` really is an `<h2>`. That is a fact
   * about a dependency, so it is asserted here rather than cited: a Radix major that
   * changed the default element would otherwise turn every `Dialog.Title` in the guarded
   * files into a silent over-count, and the guards would keep passing.
   *
   * `createElement` rather than JSX because this is a `.ts` file — deliberately, so the
   * source guards stay a fast pure-string check with no renderer in the common path.
   */
  async function renderTitle(asChild: boolean) {
    const { createElement: h } = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const Dialog = await import('@radix-ui/react-dialog');

    const title = asChild
      ? h(Dialog.Title, { asChild: true }, h('h1', null, 'Wizard title'))
      : h(Dialog.Title, null, 'Wizard title');

    render(
      h(
        Dialog.Root,
        { open: true },
        h(Dialog.Portal, null, h(Dialog.Content, { 'aria-describedby': undefined }, title))
      )
    );

    return screen.getByText('Wizard title');
  }

  it('a bare Dialog.Title renders an h2 — so countH2 counts it', async () => {
    expect((await renderTitle(false)).tagName).toBe('H2');
  });

  it('an asChild Dialog.Title renders the child, and still labels the dialog', async () => {
    // Both halves matter. The element is why `WizardContainer` can own its route's h1;
    // the labelling is why using `asChild` to get there is not a downgrade — Radix passes
    // its generated id to the child, so the dialog keeps its accessible name.
    const el = await renderTitle(true);

    expect(el.tagName).toBe('H1');
    expect(el.id, 'Radix did not pass its title id to the child').toBeTruthy();
    expect(el.closest('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(el.id);
  });

  it('every Dialog.Title in a guarded file is classified, and none is miscounted', () => {
    // The two regexes must partition: bare ones count as an h2, asChild ones do not.
    const cases: Array<[string, string, number, number]> = [
      // name, source, total Dialog.Title, of which bare (counted as h2)
      ['ProjectsList.tsx', projectsListSource, 1, 1],
      ['WizardContainer.tsx', wizardContainerSource, 1, 0],
    ];

    for (const [name, source, total, bare] of cases) {
      expect(count(source, DIALOG_TITLE_ANY), `${name}: Dialog.Title count moved`).toBe(total);
      expect(
        count(source, DIALOG_TITLE_BARE),
        `${name}: a Dialog.Title gained or lost asChild — its rendered level changed`
      ).toBe(bare);
    }
  });
});

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
      // ever supply a heading. Two literal h1s (WIC-1099): the sr-only one on the
      // session-bootstrap branch, and the mode-dependent one on the signed-out form — the
      // two are mutually exclusive at render time, never both mounted at once.
      name: 'Login.tsx',
      source: loginSource,
      h1: 2,
      h2: 0,
      h3: 0,
      note: 'the page owns the /login h1 itself, on both of its branches',
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
      // The other "component is the page body" case, and the one that arrived by merge
      // rather than by this PR: WIC-1141 (#97) turned this file's `h1` into a bare
      // `Dialog.Title`, costing /projects/new/dialogue its only level-1 heading on all
      // four branches. `DialogueCapture` is the sole call site and emits no heading, so
      // the h1 belongs here. Restored via `Dialog.Title asChild`, which is why `h2` pins
      // at 0 — the title contributes the child `h1`, not a level-2 heading of its own.
      //
      // The surviving `h3` is correct: it renders inside a `WizardStep`, which emits the
      // `h2`, so the outline reads h1 -> h2 -> h3. Same shape as ReportsClosedLoop.
      name: 'WizardContainer.tsx',
      source: wizardContainerSource,
      h1: 1,
      h2: 0,
      h3: 1,
      note: 'the wizard/dialog title as the route h1; its h3 sits under WizardStep’s h2',
    },
    {
      name: 'ProjectsList.tsx',
      source: projectsListSource,
      h1: 1,
      h2: 2,
      h3: 0,
      // The "Create New Project" heading is a `<Dialog.Title>` since WIC-1141 (#97), not a
      // literal `<h2>`. It still renders an h2, so it still counts — see `countH2`.
      note: 'the project row card + the "Create New Project" dialog title',
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
      countH2(source),
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
    // The size pin is the third: WIC-1675 changes eleven production files — the ten it
    // fixed directly, plus `WizardContainer.tsx`, whose h1 this branch restored after
    // WIC-1141 (#97) removed it on main. Every one of them must appear. A future fix that
    // lands without a guard has to edit this number, which is the visible edit the old
    // check failed to force.
    expect(executed.length, 'a guard was deleted or skipped').toBe(guards.length);
    expect([...executed].sort(), 'the guards that ran are not the table').toEqual(
      guards.map((g) => g.name).sort()
    );
    expect(
      new Set(executed).size,
      'the table must cover all eleven files WIC-1675 changed, each exactly once'
    ).toBe(11);
  });
});
