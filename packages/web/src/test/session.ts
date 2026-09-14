import { AUTH_TOKEN_KEY } from '../services/appStorage';

/**
 * Put a signed-in session in `localStorage`, which is where the production
 * `apiClient` reads its bearer token from (`services/api/index.ts`).
 *
 * Call this in any test that renders an authenticated surface through the real
 * `apiClient` rather than a mock of it. Before WIC-2384 that was unnecessary:
 * `APIClient.request` attached the Authorization header only `if (token)` and
 * sent the request regardless, so a tokenless test still reached the stubbed
 * `fetch` and every URL assertion passed. The client now refuses to send a
 * request it knows can only 401, which makes the missing session visible.
 *
 * So this is not a workaround for the guard — it is the setup those tests always
 * needed. Each of them depicts a signed-in user (a filter panel over their
 * applications, an application detail page); none was asserting anything about
 * the signed-out state, and none of their assertions change meaning with a
 * session present.
 *
 * ⚠️ Call it *after* any `localStorage.clear()` in the same `beforeEach`, or the
 * clear wins. That ordering is why this is an explicit call rather than a global
 * default in `test/setup.ts`.
 */
export function seedAuthSession(token = 'test-session-jwt'): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}
