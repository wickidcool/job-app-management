import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { RouteMatchProvider } from '../contexts/RouteMatchContext';
import { MobileNavigation } from './MobileNavigation';
import { TopNavigation } from './TopNavigation';

/**
 * WIC-2181 — the Applications nav badge must say "12+", not "12", when the number behind
 * it is a lower bound.
 *
 * `App` derives that badge by filtering the rows `useApplicationCollection` returned. If
 * `getAllPaged` ran out of page budget those rows are a prefix of the account, so the
 * filter's result is a floor and not a count. Nothing else on the screen says so — a nav
 * badge has no room for the sentence `ApplicationsList` uses — which is why the marker
 * goes on the number itself.
 *
 * Reachable only at `MAX_APPLICATION_PAGES` x `APPLICATION_PAGE_SIZE` = 5,000 applications
 * for one user, i.e. for nobody. Covered anyway because the two surfaces have to agree:
 * they render the badge from separate copies of the same markup, so a fix applied to one
 * and forgotten on the other is invisible to any test that only looks at the one.
 *
 * WHY THE `+` IS `aria-hidden` WITH AN `sr-only` TWIN. Screen readers disagree about
 * punctuation: some announce "plus", some drop it silently. Leaving it bare would let a
 * listener hear the undercount as an exact figure, which is the defect. This is the same
 * hidden-glyph-plus-spoken-replacement shape WIC-1850 used on the palette's result rows.
 *
 * ⚠️ The assertions therefore have to distinguish the two channels. `toHaveTextContent`
 * sees `aria-hidden` nodes, so it alone cannot tell "12+" from "12+ or more" — every test
 * below pairs the visible reading with the announced one, and the negative controls assert
 * the absence of BOTH.
 */

// `TopNavigation` renders the user menu, which needs auth context. Mocked at module scope
// rather than wrapped in a real provider, which would fire `/api/auth/me` from a unit test
// — the same reason `navigation-active-state.test.tsx` does it.
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

function renderNav(ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <RouteMatchProvider>{ui}</RouteMatchProvider>
    </MemoryRouter>
  );
}

/** The drawer holding `MobileNavigation`'s primary items is closed until it is opened. */
async function openDrawer() {
  await userEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
}

/** What a sighted user reads, including `aria-hidden` decoration. */
function visibleBadgeText(link: HTMLElement) {
  return link.textContent ?? '';
}

/** What a screen reader is handed: the same subtree with hidden nodes removed. */
function announcedBadgeText(link: HTMLElement) {
  const clone = link.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

describe('TopNavigation Applications badge', () => {
  it('marks the count as a lower bound when the collection was truncated', () => {
    renderNav(<TopNavigation applicationCount={12} applicationCountIsLowerBound />);

    const tab = screen.getByRole('tab', { name: /Applications/ });
    expect(visibleBadgeText(tab)).toContain('12+');
    expect(announcedBadgeText(tab)).toContain('12 or more');
  });

  it('NEGATIVE CONTROL: renders the bare count when the collection is complete', () => {
    // The control that stops the fix from being "always append +". Everything is held
    // constant except the flag.
    renderNav(<TopNavigation applicationCount={12} />);

    const tab = screen.getByRole('tab', { name: /Applications/ });
    expect(visibleBadgeText(tab)).toContain('12');
    expect(visibleBadgeText(tab)).not.toContain('12+');
    expect(announcedBadgeText(tab)).not.toContain('or more');
  });

  it('NEGATIVE CONTROL: the flag does not leak onto a different tab’s badge', () => {
    // `exportCount` shares the badge markup but is a real count — it comes from
    // `useExports`, which does not page. Passing the applications flag must not qualify it.
    renderNav(<TopNavigation applicationCount={12} applicationCountIsLowerBound exportCount={4} />);

    const resumes = screen.getByRole('button', { name: /Resumes/ });
    expect(visibleBadgeText(resumes)).toContain('4');
    expect(visibleBadgeText(resumes)).not.toContain('4+');
    expect(announcedBadgeText(resumes)).not.toContain('or more');
  });
});

describe('MobileNavigation Applications badge', () => {
  it('marks the count as a lower bound when the collection was truncated', async () => {
    renderNav(<MobileNavigation applicationCount={12} applicationCountIsLowerBound />);
    await openDrawer();

    const link = screen.getByRole('link', { name: /Applications/ });
    expect(visibleBadgeText(link)).toContain('12+');
    expect(announcedBadgeText(link)).toContain('12 or more');
  });

  it('NEGATIVE CONTROL: renders the bare count when the collection is complete', async () => {
    renderNav(<MobileNavigation applicationCount={12} />);
    await openDrawer();

    const link = screen.getByRole('link', { name: /Applications/ });
    expect(visibleBadgeText(link)).toContain('12');
    expect(visibleBadgeText(link)).not.toContain('12+');
    expect(announcedBadgeText(link)).not.toContain('or more');
  });

  it('NEGATIVE CONTROL: the flag does not leak onto a different item’s badge', async () => {
    renderNav(
      <MobileNavigation applicationCount={12} applicationCountIsLowerBound exportCount={4} />
    );
    await openDrawer();

    const resumeManager = screen.getByRole('link', { name: /Resume Manager/ });
    expect(visibleBadgeText(resumeManager)).toContain('4');
    expect(visibleBadgeText(resumeManager)).not.toContain('4+');
    expect(announcedBadgeText(resumeManager)).not.toContain('or more');
  });
});
