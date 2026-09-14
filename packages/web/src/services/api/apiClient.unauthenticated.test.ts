import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APIClient, APIError } from './apiClient';

/**
 * WIC-2384: an unauthenticated request signs the user out.
 *
 * `request()` used to attach the Authorization header only `if (token)` and send the
 * request either way. Every endpoint reachable through this client is behind the
 * Worker's JWT middleware, so a tokenless request can only come back 401 — and the 401
 * branch dispatches `auth:unauthorized`, which `AuthContext` handles by clearing storage
 * and nulling the session. A component that mounts or refetches in the window before the
 * token is written therefore destroys the session the user just established.
 *
 * That was five failing specs in `multi-user-isolation.spec.ts` with one cause: a bare
 * `GET /applications?limit=100` racing login. Four of them were 30s waits for UI that
 * never arrived because the app had signed itself out; the fast one is the `:554`
 * assertion that no API request goes out without an Authorization header.
 *
 * The two assertions that matter here are about what does NOT happen, and neither is
 * observable from the thrown error alone:
 *
 *   1. `fetch` is never called — the request is refused locally rather than sent and
 *      rejected. This is the property the E2E spec asserts on the wire.
 *   2. `auth:unauthorized` is never dispatched — no server said the session was invalid,
 *      so nothing should tear it down. Dispatching here would reproduce the original bug
 *      through the new code path while still passing assertion 1.
 *
 * The token-present case is the control: without it a `request()` that threw
 * unconditionally would satisfy every assertion above.
 */

const UNAUTHORIZED_EVENT = 'auth:unauthorized';

function makeClient(token: string | null) {
  return new APIClient({
    baseURL: 'http://api.test',
    getAuthToken: async () => token,
  });
}

/**
 * A plain counter and a typed `EventListener`, rather than a `vi.fn()`: the event is
 * custom, so it is not in `WindowEventMap`, and a mock is not assignable to
 * `EventListenerOrEventListenerObject` under the strict web build. Vitest runs a
 * `vi.fn()` here quite happily — `npm run build` is what rejects it.
 */
let unauthorizedCount = 0;
const countUnauthorized: EventListener = () => {
  unauthorizedCount += 1;
};

beforeEach(() => {
  unauthorizedCount = 0;
  window.addEventListener(UNAUTHORIZED_EVENT, countUnauthorized);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.removeEventListener(UNAUTHORIZED_EVENT, countUnauthorized);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('APIClient.request with no auth token', () => {
  it('refuses locally instead of sending a request that can only 401', async () => {
    const client = makeClient(null);

    await expect(client.request('/applications?limit=100')).rejects.toBeInstanceOf(APIError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not dispatch auth:unauthorized, so it cannot clear the session', async () => {
    const client = makeClient(null);

    await expect(client.request('/applications')).rejects.toThrow();
    expect(unauthorizedCount).toBe(0);
  });

  it('reports the refusal as UNAUTHENTICATED rather than a server error', async () => {
    const client = makeClient(null);

    const error = await client.request('/dashboard').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).code).toBe('UNAUTHENTICATED');
  });
});

describe('APIClient.request with a token (control)', () => {
  it('sends the request and always attaches the Authorization header', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = makeClient('jwt-for-a-live-session');

    await expect(client.request('/applications')).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://api.test/applications');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer jwt-for-a-live-session'
    );
    expect(unauthorizedCount).toBe(0);
  });
});
