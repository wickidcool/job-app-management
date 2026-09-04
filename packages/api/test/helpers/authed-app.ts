import { SignJWT } from 'jose';
import { buildApp } from '../../src/app.js';
import { _resetConfig } from '../../src/config.js';
import { _resetJwksCache } from '../../src/middleware/auth.js';

/**
 * An app whose every request carries a real authenticated owner (WIC-1638).
 *
 * The route suites for catalog / resume-variants / interview-preps were written
 * against a bare `buildApp()` with no Supabase config, which makes
 * `middleware/auth.ts` bypass auth entirely and leave `userId` null. That was
 * fine while the services took `userId?: string` — the owner simply arrived as
 * `undefined` and the predicate degraded. It is not fine now: those routes call
 * `requireOwner`, so an owner-less request is a 401 and never reaches the
 * service. Every one of those tests is asserting an HTTP contract (status codes,
 * payload shapes, Zod validation), not tenancy, so the fix is to give them a
 * caller rather than to relax the guard.
 *
 * This deliberately does NOT special-case local dev inside `requireOwner`.
 * ADR-010 D3 has since landed (WIC-1964): the bypass in `middleware/auth.ts`
 * resolves a real `LOCAL_DEV_USER_ID` instead of an absence, so local dev is a
 * tenant rather than an owner-less caller. That does not make this helper
 * redundant. These suites assert HTTP contracts, and pinning them to an explicit
 * JWT-derived owner keeps them independent of the bypass — they neither depend on
 * the sentinel's value nor change meaning if `LOCAL_DEV_USER_ID` is re-pointed.
 * The bypass's own behaviour is covered directly in `test/local-dev-owner.test.ts`.
 *
 * `wrap` returns a `.request()`-shaped object rather than a real Hono app so the
 * call sites do not change: only the `app = buildApp()` line in each suite does.
 * Per-request `headers` still win, so a test that overrides `authorization` (or
 * drops it) to exercise the unauthenticated path keeps working.
 */

export const TEST_JWT_SECRET = 'super-secret-jwt-key-for-testing-only-32-chars!!';
export const TEST_USER_ID = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

let cachedToken: string | undefined;

async function token(): Promise<string> {
  if (!cachedToken) {
    cachedToken = await new SignJWT({ sub: TEST_USER_ID })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));
  }
  return cachedToken;
}

/** Minimal surface these suites use off a Hono app. */
export interface AuthedApp {
  request(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * Configure JWT auth, build the app, and return it with the bearer token
 * pre-attached. Call from an `async beforeEach`.
 */
export async function buildAuthedApp(): Promise<AuthedApp> {
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
  _resetConfig();
  _resetJwksCache();

  const app = buildApp();
  const authorization = `Bearer ${await token()}`;

  return {
    request(path: string, init: RequestInit = {}) {
      return app.request(path, {
        ...init,
        headers: { authorization, ...(init.headers ?? {}) },
      });
    },
  };
}

/** Undo `buildAuthedApp`'s env mutation. Call from `afterEach`. */
export function resetAuthEnv(): void {
  delete process.env.SUPABASE_JWT_SECRET;
  _resetConfig();
  _resetJwksCache();
}
