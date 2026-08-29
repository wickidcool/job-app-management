import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { Login } from './Login';
import { getOutline, findOutlineSkips, describeOutline } from '../test/headingOutline';

/**
 * `/login` shipped with an h2 and no h1, and the h2 said the wrong thing (WIC-1099 §2).
 * Its text was the product name — `Job Application Manager` — so the page's highest heading
 * was a level 2 with no level 1 above it, and heading navigation landed on a string that
 * names the *product* rather than the screen or the task.
 *
 * Three branches, not two. The ticket lists the signed-out form; the component also returns
 * early while `AuthContext` is still resolving the session, and that branch had no heading
 * of any level either. It is the same class as the `/job-fit-analysis` stage branches in §3
 * of the same ticket: an early return is its own document outline, and a per-file grep for
 * `<h1` sees one file and reports it clean.
 *
 * The register mode is a fourth outline. The h1 changes with the mode on purpose — the mode
 * switch is a deliberate user action that changes what the screen asks for, which is exactly
 * when an accessible name *should* change. That is the opposite of the §3 case, where the
 * name moved by itself because an async stage advanced under the user.
 */
const mockAuth = {
  user: null as unknown,
  login: vi.fn(),
  register: vi.fn(),
  loading: false,
};

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAuth.user = null;
  mockAuth.loading = false;
});

describe('/login heading outline (WIC-1099 §2)', () => {
  it('names the task in an h1, not the product', () => {
    renderLogin();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/^Sign in$/);
  });

  it('leaves the product name on the page but out of the heading outline', () => {
    // The string is unchanged: `ROUTE_TITLE_CONVENTION.md` §2 has this and `index.html:13`
    // as the last two places saying `Job Application Manager` pending a Copywriter call on
    // Careerpin. This asserts the split that lets those two decisions stay separate — the
    // wordmark still renders, and it is no longer a heading.
    renderLogin();

    expect(screen.getByText('Job Application Manager')).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('heading')
        .filter((h) => h.textContent?.trim() === 'Job Application Manager')
    ).toHaveLength(0);
  });

  it('renames the h1 when the user switches to registering', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/^Create an account$/);
  });

  it('carries an h1 through the session-bootstrap branch too', () => {
    // The branch the ticket's audit did not reach. It renders `Loading...` and returns
    // before the form exists, so it is a separate outline from every assertion above —
    // and a user who lands on /login with a slow session check sits in it.
    mockAuth.loading = true;
    renderLogin();

    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Sign in$/);
  });

  it('never skips a heading level, in any of the four branches', async () => {
    const user = userEvent.setup();

    mockAuth.loading = true;
    const bootstrap = renderLogin();
    expect(describeOutline(getOutline(bootstrap.container))).toBe('h1 "Sign in"');
    bootstrap.unmount();

    mockAuth.loading = false;
    const signedOut = renderLogin();
    expect(getOutline(signedOut.container)[0]?.level).toBe(1);
    expect(findOutlineSkips(getOutline(signedOut.container))).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(getOutline(signedOut.container)[0]?.level).toBe(1);
    expect(findOutlineSkips(getOutline(signedOut.container))).toEqual([]);
  });
});
