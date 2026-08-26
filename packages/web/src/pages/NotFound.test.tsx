import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import appSource from '../App.tsx?raw';
import { EmptyState } from '../components/EmptyState';
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
 * check (real router, real chrome) but does not currently run in CI (WIC-1085). Items
 * 4 and 5 are keyboard/AT behaviour that e2e was never going to cover.
 */

/** A stand-in for whatever real page a successful navigation lands on. */
function Landed() {
  return <h1>Landed</h1>;
}

/**
 * NotFound under a router, with a second route to navigate to.
 *
 * `initialEntries` with a single entry leaves `location.key === 'default'`, which is
 * how the page detects a cold deep-link — see the back-gating test below.
 */
function renderNotFound(initialEntries: string[] = ['/no-such-page']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={<Landed />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
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
    // NOTE: since WIC-1155 these two no longer discriminate against the rejected
    // EmptyState option — that component dropped its region landmark and its
    // "Empty state" label, so it now satisfies them too (see the control below).
    // They are kept as a plain regression guard on NotFound's own markup; D2 is
    // what still carries the §1 argument.
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
   * D1 has expired, and deliberately so. This control originally asserted that
   * EmptyState exposes a region landmark named "Empty state" — the first of the
   * three defects that made it unfit as a page-level 404. WIC-1155 (#99) then
   * removed that landmark from EmptyState outright, for an unrelated and stronger
   * reason: the wrapper's ARIA kept its action button reachable behind every open
   * modal. So the defect is genuinely gone rather than merely unasserted, and the
   * honest control is now the opposite assertion. Its consequence is recorded on
   * the test above: the region/label half of that test can no longer be failed by
   * this component, and D2 is the only half still discriminating.
   */
  it('negative control: the rejected EmptyState reuse would fail those assertions', () => {
    render(<EmptyState variant="no-results" />);

    // D1, inverted by WIC-1155: no landmark at all, so it cannot compete with
    // <main> — but equally it no longer names itself, so this is not the reason
    // the option was rejected any more.
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Empty state')).not.toBeInTheDocument();
    // D2 — still the live discriminator: an h3 with no h1 above it is exactly the
    // broken document outline a 404 page must not ship.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
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
   * §2.1 — the spec rejects a secondary "Go back" outright; this branch ships it gated
   * on having somewhere in-app to go back to. The gate is the part that must not
   * regress: on a cold deep-link from outside the app, "back" would eject the user out
   * of it entirely, which is the failure mode the spec's objection is really about.
   */
  it('hides "Go back" on a cold deep-link', () => {
    renderNotFound();

    expect(screen.queryByRole('button', { name: /go back/i })).not.toBeInTheDocument();
  });

  it('offers "Go back" once there is an in-app history entry', async () => {
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
        <Routes>
          <Route path="/" element={<GoNowhere />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Follow a dead link' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/couldn't be found/i);
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
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
