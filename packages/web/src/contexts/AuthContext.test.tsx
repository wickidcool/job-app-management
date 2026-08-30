import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './AuthContext';
import { APP_STORAGE_KEYS } from '../services/appStorage';

/**
 * AC-3 for WIC-1495: sign in, populate the app's `localStorage` keys, sign out,
 * assert nothing app-owned survives.
 *
 * This drives the real `AuthProvider` and the real `signOut` — not a stand-in that
 * calls `clearAppStorage()` directly. The defect was never in the sweep; it was
 * that logout did not call one. A test that invokes the sweep itself is green on
 * the broken tree.
 *
 * The key strings below are written out as literals **on purpose**. Importing them
 * from `appStorage.ts` would make the fixture a restatement of the registry, and a
 * key dropped from the registry would take the fixture with it and stay green.
 * `pins the registry against this file's independent key list` then closes the
 * other direction: the two lists must agree, so drift in either fails here.
 */

/** Written independently of `appStorage.ts`. See the note above. */
const EXACT_KEYS = [
  'auth_token',
  'wic-recent-searches',
  'wic-saved-filters',
  'onboarding_progress',
];

/** Members of the `dialogue-wizard-draft-*` family, which no exact list can enumerate. */
const FAMILY_KEYS = ['dialogue-wizard-draft-create', 'dialogue-wizard-draft-enrich-9f3a21b0'];

/** Not the app's. Sweeping this would be overreach, so it is asserted to survive. */
const FOREIGN_KEY = 'unrelated-third-party';

const USER = { id: 'user-1', email: 'first.user@example.test' };

function Probe() {
  const { user, loading, login, signOut } = useAuth();
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : user ? `in:${user.email}` : 'out'}</span>
      <button type="button" onClick={() => void login(USER.email, 'correct-horse')}>
        log in
      </button>
      <button type="button" onClick={() => void signOut()}>
        sign out
      </button>
    </div>
  );
}

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) {
      return new Response(JSON.stringify({ token: 'jwt-for-first-user', user: USER }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/auth/logout')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith('/auth/me')) {
      return new Response(JSON.stringify({ user: USER }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Everything currently in `localStorage`, sorted, so assertions are order-free. */
function storedKeys(): string[] {
  return Object.keys(localStorage).sort();
}

describe('AuthContext signOut clears app localStorage (WIC-1495)', () => {
  beforeEach(() => {
    localStorage.clear();
    stubApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('pins the registry against this file’s independent key list', () => {
    // Cross-check, not a derivation: EXACT_KEYS is hand-written above. If a key is
    // added to the app and registered but not added here, or registered under a
    // changed name, this fails rather than the fixture silently shrinking.
    expect([...APP_STORAGE_KEYS].sort()).toEqual([...EXACT_KEYS].sort());
    expect(EXACT_KEYS.length).toBe(4);
    expect(FAMILY_KEYS.length).toBeGreaterThan(1);
  });

  it('clears every app-owned key on sign-out and leaves foreign keys alone', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    // Sign in through the real login(), which is what writes `auth_token`.
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
    await user.click(screen.getByRole('button', { name: 'log in' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(`in:${USER.email}`));
    expect(localStorage.getItem('auth_token')).toBe('jwt-for-first-user');

    // The other four keys are written by components that need a whole page mounted
    // to reach; seeding the same strings they write is equivalent for a sweep that
    // enumerates the store, and keeps this test about logout.
    for (const key of EXACT_KEYS.filter((k) => k !== 'auth_token')) {
      localStorage.setItem(key, JSON.stringify(['Acme Corp', 'Staff Engineer']));
    }
    for (const key of FAMILY_KEYS) {
      localStorage.setItem(key, JSON.stringify({ data: { company: 'Acme Corp' } }));
    }
    localStorage.setItem(FOREIGN_KEY, 'keep me');

    // The fixture has to actually be there, or the post-logout assertion is a
    // statement about an already-empty store.
    expect(storedKeys()).toEqual([...EXACT_KEYS, ...FAMILY_KEYS, FOREIGN_KEY].sort());

    await user.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));

    expect(storedKeys()).toEqual([FOREIGN_KEY]);
  });

  it('leaves nothing for the next user to read from a shared browser', async () => {
    // The card's threat model stated as the assertion: after a sign-out, no value
    // remaining in localStorage contains the previous user's content. Distinct from
    // the key-name check above, which a sweep that blanked values without removing
    // keys would still pass.
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
    await user.click(screen.getByRole('button', { name: 'log in' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(`in:${USER.email}`));

    const secrets = [
      'Acme Corp',
      'Staff Engineer',
      'first.user@example.test',
      'jwt-for-first-user',
    ];
    localStorage.setItem('wic-recent-searches', JSON.stringify(secrets.slice(0, 3)));
    localStorage.setItem('dialogue-wizard-draft-create', JSON.stringify({ data: { s: secrets } }));
    localStorage.setItem('onboarding_progress', JSON.stringify({ step: 3, who: secrets[2] }));
    localStorage.setItem('wic-saved-filters', JSON.stringify([{ name: secrets[1] }]));

    await user.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));

    const remaining = Object.values(localStorage).join('|');
    for (const secret of secrets) {
      expect(remaining).not.toContain(secret);
    }
  });

  it('still ends the server session before clearing the token', async () => {
    // signOut reads the token to authorise POST /auth/logout. Moving the sweep
    // above that read would leave the server session alive; this pins the order.
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
    await user.click(screen.getByRole('button', { name: 'log in' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(`in:${USER.email}`));

    await user.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));

    const logoutCall = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/auth/logout'));
    expect(logoutCall).toBeDefined();
    expect((logoutCall?.[1]?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      'Bearer jwt-for-first-user'
    );
  });

  it('clears the same keys when the session expires, not just on an explicit sign-out', async () => {
    // Second exit path, same threat. `signOut` is the button; `auth:unauthorized` is
    // what a 401 raises when a session expires underneath the user. Both end the
    // session, so both must sweep — a user whose session expired and who then walked
    // away from a shared machine leaks exactly what an un-swept logout leaked.
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
    await user.click(screen.getByRole('button', { name: 'log in' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(`in:${USER.email}`));

    for (const key of EXACT_KEYS.filter((k) => k !== 'auth_token')) {
      localStorage.setItem(key, JSON.stringify(['Acme Corp', 'Staff Engineer']));
    }
    for (const key of FAMILY_KEYS) {
      localStorage.setItem(key, JSON.stringify({ data: { company: 'Acme Corp' } }));
    }
    localStorage.setItem(FOREIGN_KEY, 'keep me');
    expect(storedKeys()).toEqual([...EXACT_KEYS, ...FAMILY_KEYS, FOREIGN_KEY].sort());

    // Exactly what `services/api/apiClient.ts` dispatches on a 401 response.
    act(() => {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    });

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
    expect(storedKeys()).toEqual([FOREIGN_KEY]);
  });
});

describe('the 401 precondition the expiry sweep depends on (WIC-1495)', () => {
  /**
   * The sweep above is only safe because `auth:unauthorized` is strictly 401-driven.
   * If it ever fired on a transient failure, a network blip would wipe a still-valid
   * session's data. That precondition lives in `apiClient`, not in `AuthContext`, so
   * it is pinned here rather than assumed — and it is pinned in BOTH directions,
   * because a "does not dispatch" assertion alone is green against a client that
   * never dispatches at all.
   */
  const dispatched: string[] = [];
  const record = () => dispatched.push('auth:unauthorized');

  beforeEach(() => {
    dispatched.length = 0;
    window.addEventListener('auth:unauthorized', record);
  });

  afterEach(() => {
    window.removeEventListener('auth:unauthorized', record);
    vi.unstubAllGlobals();
  });

  it('dispatches on a 401 and stays silent on a network failure', async () => {
    const { createAPIClient } = await import('../services/api/apiClient');
    const client = createAPIClient({
      baseURL: 'https://api.test',
      getAuthToken: async () => 'jwt-for-first-user',
    });

    // Allowed control first: without this, the negative below proves nothing.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    await expect(client.get('/anything')).rejects.toThrow();
    expect(dispatched).toEqual(['auth:unauthorized']);

    // Offline: fetch rejects outright, so the 401 branch is never reached.
    dispatched.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(client.get('/anything')).rejects.toThrow();
    expect(dispatched).toEqual([]);
  });
});
