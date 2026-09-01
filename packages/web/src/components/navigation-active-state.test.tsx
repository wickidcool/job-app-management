import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { RouteMatchProvider, useReportRouteUnmatched } from '../contexts/RouteMatchContext';
import { TopNavigation } from './TopNavigation';
import { MobileNavigation } from './MobileNavigation';
import { BottomTabBar } from './BottomTabBar';

/**
 * Nav active-state on an unmatched path (WIC-1053).
 *
 * All three nav surfaces decide "you are here" with a `startsWith` prefix match,
 * which they have to: `/applications/new` is a real route that should keep the
 * Applications tab lit. The bug is that `/reports/pipelin` — a typo matching no
 * route — lights up Reports just as convincingly, and in `TopNavigation` sets
 * `aria-current="page"` while the 404 heading below says the page was not found.
 *
 * These render the nav *without* the 404 page, standing in for it with a component
 * that calls the same reporting hook, so a failure points at the nav rather than at
 * anything in `NotFound.tsx`.
 */

// Minimal stand-in for `NotFound`, which is what reports the unmatched route in the
// real tree. Rendered as a sibling of the nav, in the same position `<main>` holds.
function UnmatchedRouteMarker() {
  useReportRouteUnmatched();
  return null;
}

function renderNav(ui: ReactNode, { path, unmatched }: { path: string; unmatched: boolean }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RouteMatchProvider>
        {ui}
        {unmatched && <UnmatchedRouteMarker />}
      </RouteMatchProvider>
    </MemoryRouter>
  );
}

// `TopNavigation` renders the user menu, which needs auth context; the nav under
// test is the tablist, so the sign-out affordance is out of scope here. Auth is
// mocked at module scope rather than wrapped in a real provider, which would fire
// a `/api/auth/me` fetch from a unit test.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'test@example.com' },
    token: 't',
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    signOut: vi.fn(),
  }),
}));

describe('TopNavigation active state', () => {
  it('marks the matching tab as the current page on a real route', () => {
    renderNav(<TopNavigation />, { path: '/reports/stale', unmatched: false });

    // Not a bug being tolerated — `/reports/stale` is a real route and a genuine
    // child of the Reports tab. This is the behaviour the fix must not break.
    expect(screen.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks no tab as the current page when the path matched no route', () => {
    renderNav(<TopNavigation />, { path: '/reports/pipelin', unmatched: true });

    expect(screen.getByRole('tab', { name: 'Reports' })).not.toHaveAttribute('aria-current');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('still prefix-matches nested real routes', () => {
    renderNav(<TopNavigation />, { path: '/applications/abc-123', unmatched: false });

    expect(screen.getByRole('tab', { name: 'Applications' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('BottomTabBar active state', () => {
  // The "More" tab has no path of its own that `/reports/pipelin` starts with; it
  // lights up through its /reports dropdown entry, so it needs its own assertion
  // rather than being covered by the primary-tab case.
  it('highlights "More" via its dropdown on a real /reports route', () => {
    renderNav(<BottomTabBar />, { path: '/reports/stale', unmatched: false });

    expect(screen.getByRole('button', { name: /More/ })).toHaveClass('text-primary-600');
  });

  it('highlights nothing when the path matched no route', () => {
    renderNav(<BottomTabBar />, { path: '/reports/pipelin', unmatched: true });

    expect(screen.getByRole('button', { name: /More/ })).not.toHaveClass('text-primary-600');
    expect(document.querySelectorAll('.text-primary-600')).toHaveLength(0);
  });
});

describe('MobileNavigation active state', () => {
  // The drawer is closed until the hamburger is clicked, and its entries only exist
  // in the DOM while open.
  async function openDrawer() {
    await userEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
  }

  it('highlights the matching entry on a real route', async () => {
    renderNav(<MobileNavigation />, { path: '/reports/stale', unmatched: false });
    await openDrawer();

    expect(screen.getByRole('link', { name: /Reports/ })).toHaveClass('text-primary-600');
  });

  it('highlights nothing when the path matched no route', async () => {
    renderNav(<MobileNavigation />, { path: '/reports/pipelin', unmatched: true });
    await openDrawer();

    expect(screen.getByRole('link', { name: /Reports/ })).not.toHaveClass('text-primary-600');
    expect(document.querySelectorAll('.text-primary-600')).toHaveLength(0);
  });
});

describe('RouteMatchProvider wiring', () => {
  // Negative control. Every assertion above would also pass against a nav that had
  // simply been hard-coded to highlight nothing, so pin that the suppression is
  // driven by the reporting hook and nothing else.
  it('suppresses active state only while an unmatched route is reported', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/reports/stale']}>
        <RouteMatchProvider>
          <TopNavigation />
          <UnmatchedRouteMarker />
        </RouteMatchProvider>
      </MemoryRouter>
    );

    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);

    // Unmounting the marker is what leaving the 404 page does.
    rerender(
      <MemoryRouter initialEntries={['/reports/stale']}>
        <RouteMatchProvider>
          <TopNavigation />
        </RouteMatchProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  });
});
