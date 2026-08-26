import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import appSource from '../App.tsx?raw';
import { EmptyState } from '../components/EmptyState';
import { CommandPaletteProvider, useCommandPalette } from '../contexts/CommandPaletteContext';
import { NotFound } from './NotFound';

/**
 * The five manual checks in the WIC-1046 UI/UX spec (§7), automated.
 *
 * WIC-1046 arrived as a design handoff assuming NotFound did not exist yet; it does,
 * on this branch. So these tests are the reconciliation: each one pins a claim the
 * spec makes about the page, so a later edit that quietly breaks it fails here rather
 * than in a screen reader.
 *
 * §7's items 1-3 are also covered by e2e/not-found.spec.ts, which is the stronger
 * check (real router, real chrome) and does run in CI. Items 4 and 5 are keyboard/AT
 * behaviour that e2e was never going to cover, so they are only pinned here.
 */

/** A stand-in for whatever real page a successful navigation lands on. */
function Landed() {
  return <h1>Landed</h1>;
}

/**
 * NotFound under a router, with a second route to navigate to.
 *
 * The default `initialEntries` is a single unmatched path, so the page renders as it
 * would on a cold deep-link; pass a longer list to exercise a different arrival.
 *
 * `CommandPaletteProvider` is required, not incidental: the page's search button
 * reads the palette from it and the hook throws without it. No `RouteMatchProvider`
 * — reporting the unmatched route is a no-op outside one, and the nav consumers that
 * care are covered in components/navigation-active-state.test.tsx.
 */
function renderNotFound(initialEntries: string[] = ['/no-such-page']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/" element={<Landed />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </CommandPaletteProvider>
    </MemoryRouter>
  );
}

describe('NotFound', () => {
  // §7.1 — an unmatched path renders the 404 page rather than an empty <main>.
  it('renders a 404 page for an unmatched path', () => {
    renderNotFound(['/reports/typo-in-this-link']);

    expect(screen.getByRole('heading', { name: /couldn't be found/i })).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    // The path is echoed back so a typo is distinguishable from a broken link.
    expect(screen.getByText('/reports/typo-in-this-link')).toBeInTheDocument();
  });

  // §7.5 / AC5 — the check the whole §1 argument exists to make. The first thing
  // announced in <main> must be the heading, at level 1, and the words "Empty state"
  // must not be anywhere near it.
  it('opens the document outline at level 1 and names nothing "Empty state"', () => {
    renderNotFound();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/couldn't be found/i);

    // No nested landmark competing with the page's <main> to be announced first.
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Empty state')).not.toBeInTheDocument();
    // A heading at h3 with no h1 above it is the outline defect §1 (D2) describes.
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();

    // Focus is moved to the heading on mount, so it is what AT announces on arrival.
    expect(heading).toHaveFocus();
  });

  /**
   * Negative control for the test above.
   *
   * Without this, "no region named Empty state" passes for any markup at all,
   * including markup with no assertions worth making. Rendering the component the
   * spec rejected (§1, Option 1: a `'not-found'` variant on `EmptyState`) shows the
   * defects are real and that the assertions above can actually fail.
   *
   * D2 (an h3 with no h1 above it) is still live in `EmptyState`, so it is still
   * controlled for by rendering the real component.
   *
   * D1 (a region landmark named "Empty state") is not: WIC-1155 removed
   * `role="region"`/`aria-live`/`aria-label` from `EmptyState` outright — for the
   * same reason §1 gave for keeping them off this page, plus the modal-hiding leak.
   * That is the defect being fixed at the source rather than the control going
   * stale, but it does leave the two D1 assertions above with nothing that can
   * falsify them. The fixture below is exactly the wrapper WIC-1155 deleted
   * (EmptyState.tsx before 6435d79/3f12bb0), kept solely to kill that vacuity: if
   * someone reintroduces a nested landmark on this page, the sibling test fails and
   * this test proves the failure was reachable.
   */
  it('negative control: the rejected EmptyState reuse would fail those assertions', () => {
    render(<EmptyState variant="no-results" />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument(); // D2
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument(); // D2
  });

  it('negative control: the landmark WIC-1155 removed would fail the D1 assertions', () => {
    render(
      <div role="region" aria-live="polite" aria-label="Empty state">
        <h3>No results found</h3>
      </div>
    );

    expect(screen.getByRole('region')).toHaveAccessibleName('Empty state'); // D1
    expect(screen.getByLabelText('Empty state')).toBeInTheDocument(); // D1
  });

  // §7.4 — the keyboard user's first Tab from page load lands on the primary action.
  it('puts the primary action one Tab away from the focused heading', async () => {
    const user = userEvent.setup();
    renderNotFound();

    await user.tab();

    const primary = screen.getByRole('link', { name: /back to dashboard/i });
    expect(primary).toHaveFocus();
    // The button keeps a visible ring precisely because it is tabbed to (§3.4/§3.6).
    expect(primary.className).toContain('focus:ring-2');
  });

  // §7.2 / AC3 — recovery is a client-side navigation, not a document request.
  it('recovers to the dashboard client-side', async () => {
    const user = userEvent.setup();
    renderNotFound();

    const primary = screen.getByRole('link', { name: /back to dashboard/i });
    // A router <Link>, not a bare anchor: relative href and no target/reload.
    expect(primary).toHaveAttribute('href', '/');

    await user.click(primary);

    expect(screen.getByRole('heading', { name: 'Landed' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /couldn't be found/i })).not.toBeInTheDocument();
  });

  /**
   * §7 item 6 / §2.1, as decided in WIC-1105 — no secondary "Go back", on any arrival.
   *
   * The version that shipped in WIC-1051 gated the button on `location.key`, which
   * suppressed it only on a cold deep-link. That is why both arrival paths are pinned
   * separately below: a guard that checked one of them would still pass against the
   * exact gate this replaces.
   *
   * Each half also asserts the action row as a whole. "No second action" is worth
   * nothing if the first one went missing too, and enumerating the controls rather
   * than querying for /go back/i means a reintroduced *back* action fails here
   * whatever it ends up being called.
   *
   * WIC-1053 added the "Search applications" button, so this no longer asserts zero
   * buttons — it names the one that is allowed. §2.1's objection was to reversing the
   * navigation (back returns you to the page holding the stale link, which is a
   * loop); a search that moves forward is not that, and on touch it is the only
   * recovery besides the dashboard link, since the Ctrl+K hint is `sm:`-only.
   */
  function expectNoBackAction() {
    expect(screen.queryByRole('button', { name: /go back/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /go back/i })).not.toBeInTheDocument();

    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Search applications');

    const actions = screen.getAllByRole('link');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName(/back to dashboard/i);
    expect(actions[0]).toHaveAttribute('href', '/');
  }

  it('offers no "Go back" on a cold deep-link', () => {
    renderNotFound();

    expectNoBackAction();
  });

  it('offers no "Go back" after an in-app navigation to a dead link either', async () => {
    const user = userEvent.setup();

    function GoNowhere() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/no-such-page')}>
          Follow a dead link
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <CommandPaletteProvider>
          <Routes>
            <Route path="/" element={<GoNowhere />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </CommandPaletteProvider>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Follow a dead link' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/couldn't be found/i);
    expectNoBackAction();
  });

  /**
   * WIC-1053 item 2 — the touch user's search affordance.
   *
   * The e2e spec drives this end to end against the real palette; this pins the same
   * wiring at unit level, where it fails faster and without a browser. A probe stands
   * in for `CommandPalette` because the palette itself pulls in the applications query.
   */
  it('opens the command palette from the search button', async () => {
    const user = userEvent.setup();

    function PaletteProbe() {
      const { open } = useCommandPalette();
      return <span data-testid="palette-state">{open ? 'open' : 'closed'}</span>;
    }

    render(
      <MemoryRouter initialEntries={['/no-such-page']}>
        <CommandPaletteProvider>
          <NotFound />
          <PaletteProbe />
        </CommandPaletteProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('palette-state')).toHaveTextContent('closed');

    await user.click(screen.getByRole('button', { name: 'Search applications' }));

    expect(screen.getByTestId('palette-state')).toHaveTextContent('open');
  });

  // The button has to render at every breakpoint, unlike the Ctrl+K hint beside it —
  // a phone has no Ctrl+K, which is the whole reason the button exists. jsdom applies
  // no media queries, so this checks the class list rather than computed style: a
  // `hidden sm:block` on the button would reproduce exactly the gap being closed.
  it('does not hide the search button on touch layouts', () => {
    renderNotFound();

    const searchButton = screen.getByRole('button', { name: 'Search applications' });
    expect(searchButton.className).not.toContain('hidden');
    expect(searchButton.className).not.toMatch(/\bsm:/);
  });
});

/**
 * AC1 and AC4 are properties of the route *table*, not of the page, and mounting App
 * costs a provider tree, an API client and an auth session. Read the source instead —
 * the same trade route-integrity.test.ts makes.
 */
describe('App route table', () => {
  const routeOrder = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

  // AC1 — a catch-all that is not last silently swallows every route below it.
  it('declares the catch-all last', () => {
    expect(routeOrder).toContain('*');
    expect(routeOrder.at(-1)).toBe('*');
  });

  // AC4 — /dashboard is in real bookmarks and histories; it must redirect, not 404.
  it('redirects /dashboard to / and replaces the history entry', () => {
    expect(routeOrder.indexOf('/dashboard')).toBeGreaterThan(-1);
    expect(routeOrder.indexOf('/dashboard')).toBeLessThan(routeOrder.indexOf('*'));

    const dashboardRoute = appSource.match(/<Route path="\/dashboard" element=\{([^}]+)\}/);
    expect(dashboardRoute?.[1]).toMatch(/<Navigate to="\/" replace \/>/);
  });
});
