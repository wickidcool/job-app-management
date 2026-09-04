import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  RouterProvider,
  Route,
  Routes,
  createMemoryRouter,
  useBlocker,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import appSource from './App.tsx?raw';

/**
 * WIC-1924 AC-1 and AC-4 — the app mounts a data router, and the two pieces of bespoke
 * navigation-interception machinery it replaces are gone.
 *
 * The behaviour this enables is tested where it belongs, against the real component, in
 * `components/wizard/WizardContainer.discardGuard.test.tsx`. What is left over is the
 * *plumbing*, and it needs its own pins because it fails silently in both directions:
 *
 *  - revert `App.tsx` to `<BrowserRouter>` and nothing here type-errors. `useBlocker`
 *    throws at run time, inside the wizard route, on the branch where the user has
 *    unsaved work — which is to say the app looks fine until someone loses answers.
 *  - re-add a second interception mechanism alongside `useBlocker` and everything stays
 *    green, because two guards that agree are indistinguishable from one.
 *
 * The route *table* is not re-asserted here. `route-integrity.test.ts`,
 * `route-title-coverage.test.ts` and `routeOutline.render.test.tsx` already parse every
 * `<Route>` out of `App.tsx` and cross-check it three ways, and they keep working
 * precisely because this migration left the table as JSX — see the comment on `router`
 * in `App.tsx` for why that was the deciding constraint.
 */

describe('App mounts a data router (AC-1)', () => {
  it('uses createBrowserRouter + RouterProvider, and no longer BrowserRouter', () => {
    expect(appSource).toMatch(/createBrowserRouter\(/);
    expect(appSource).toMatch(/<RouterProvider\s+router=\{router\}\s*\/>/);

    // The negative half is the one that matters. `<BrowserRouter>` is a drop-in that
    // renders every route identically and supplies no `DataRouterContext`, so putting
    // it back breaks only `useBlocker` — and only on the dirty-wizard branch.
    //
    // Over stripped source, because `AppShell`'s own doc comment names the thing it
    // replaced. This assertion failed on that comment when it was first written, which
    // is the same class `route-integrity.test.ts` strips for — prose about a route is
    // not a route, and prose about a router is not a router.
    expect(
      stripComments(appSource),
      'App.tsx mounts a plain BrowserRouter again; useBlocker throws under it (WIC-1924)'
    ).not.toMatch(/<BrowserRouter[\s>]/);
  });

  it('is reading the real App.tsx', () => {
    // `?raw` on a missing path is a build error, but a stub would make both directions
    // above pass vacuously — the `not.toMatch` most of all.
    expect(appSource.length).toBeGreaterThan(2000);
    expect(appSource).toMatch(/<Route path="\/projects\/new\/dialogue"/);
  });
});

describe('the router shape App.tsx uses does supply useBlocker (the AC-1 premise)', () => {
  /**
   * `App.tsx` keeps its route table as descendant `<Routes>` under a single catch-all
   * data route, so "the app mounts `RouterProvider`" is not on its own enough to
   * conclude the wizard can block: it would also have to be true that a blocker
   * registered *inside* descendant `<Routes>` sees navigations at all.
   *
   * It is true — `useBlocker` reads `DataRouterContext` from `RouterProvider` at the
   * top and there is only one router underneath it — but that is a fact about React
   * Router, which is a dependency, so it is measured here rather than cited. A major
   * that moved blocking down to the matched route would otherwise turn the wizard's
   * guard into a no-op with nothing red.
   */
  function Probe() {
    const blocker = useBlocker(true);
    const navigate = useNavigate();
    const location = useLocation();
    return (
      <div>
        <span data-testid="state">{blocker.state}</span>
        <span data-testid="path">{location.pathname}</span>
        <button onClick={() => navigate('/projects')}>go</button>
      </div>
    );
  }

  it('blocks a navigation raised from inside descendant <Routes>', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <Routes>
              <Route path="/projects/new/dialogue" element={<Probe />} />
              <Route path="/projects" element={<h1>Projects landing</h1>} />
            </Routes>
          ),
        },
      ],
      { initialEntries: ['/projects/new/dialogue'] }
    );

    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('state').textContent).toBe('unblocked');

    await act(async () => {
      screen.getByText('go').click();
    });

    expect(screen.getByTestId('state').textContent).toBe('blocked');
    expect(screen.getByTestId('path').textContent).toBe('/projects/new/dialogue');
    expect(screen.queryByRole('heading', { name: 'Projects landing' })).not.toBeInTheDocument();
  });
});

describe('the machinery useBlocker replaces is gone (AC-4)', () => {
  // Every `.ts`/`.tsx` under `src`, so a re-introduction anywhere is caught rather than
  // only in the files this card happened to touch.
  const sources = import.meta.glob('./**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('is scanning the whole app, not an empty glob', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(Object.keys(sources)).toContain('./App.tsx');
  });

  it.each([
    ['useInAppNavigationGuard', 'the capture-phase anchor-click listener'],
    ['registerNavigationGuard', "the CommandPaletteContext guard slot's setter"],
    ['requestNavigation', "the palette's pre-navigation consult"],
  ])('no file references %s (%s)', (name) => {
    // Identifiers only. `WizardContainer.tsx` and `CommandPalette.tsx` both name these
    // in prose explaining what they replaced, and deleting that history to satisfy a
    // grep would be the wrong trade — a comment that says why a mechanism went is worth
    // more than one fewer string match.
    const offenders = Object.entries(sources)
      .filter(([file]) => file !== './App.dataRouter.test.tsx')
      .filter(([, source]) => stripComments(source).includes(name))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it('the hook file itself is deleted, not merely unreferenced', () => {
    expect(Object.keys(sources)).not.toContain('./hooks/useInAppNavigationGuard.ts');
  });
});

/** Line and block comments out, so prose naming a retired identifier does not count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
