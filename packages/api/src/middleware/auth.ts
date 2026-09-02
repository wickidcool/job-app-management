import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import type { AppEnv } from '../types/env.js';
import { getConfig } from '../config.js';

const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'];

// Cache JWKS keyed by issuer URL — avoids reconstructing the fetcher per request
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRemoteJwks(issuer: string) {
  if (!jwksCache.has(issuer)) {
    jwksCache.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  }
  return jwksCache.get(issuer)!;
}

export function _resetJwksCache() {
  jwksCache.clear();
}

/**
 * WIC-1554 — the authenticated caller's id, or a rejected request.
 *
 * A token can verify perfectly — right signature, right issuer, right audience,
 * unexpired — and still carry no `sub`. This previously read
 * `(payload.sub as string) ?? null` and called `next()`, so such a request was
 * *authenticated with no identity*: `userId: null`, which every route launders
 * into `undefined` via `c.get('userId') ?? undefined`, which the services then
 * treated as "no owner filter". `/api/projects/*` is not in `PUBLIC_PATHS`, so
 * this was reachable on the guarded path in a fully configured deployment, not
 * only in the local bypass.
 *
 * There is no such thing as an anonymous authenticated caller, so this is a 401
 * rather than something for each service to defend against. Note the check is
 * not `?? null`: that admits an empty-string `sub`, which is falsy and degrades
 * identically at every call site downstream.
 *
 * The genuine dev bypass is a different branch and is untouched — it is the
 * `!supabaseUrl && !jwtSecret` early return above, per ADR-003.
 */
function requireSubject(payload: { sub?: unknown }): string {
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    // Thrown inside the caller's `try`, matching the `Missing iss claim` path
    // below: the response is the generic 401, which discloses nothing about
    // which claim was wrong.
    throw new Error('Missing sub claim');
  }
  return payload.sub;
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const supabaseUrl = (c.env?.SUPABASE_URL as string | undefined) ?? getConfig().supabaseUrl;
  const jwtSecret =
    (c.env?.SUPABASE_JWT_SECRET as string | undefined) ?? getConfig().supabaseJwtSecret;

  // Bypass when no Supabase config is present (local dev without auth)
  if (!supabaseUrl && !jwtSecret) {
    c.set('userId', null);
    return next();
  }

  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.includes(path)) {
    c.set('userId', null);
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } },
      401
    );
  }

  const token = authHeader.slice(7);
  try {
    const header = decodeProtectedHeader(token);

    if (header.alg === 'ES256' || header.alg === 'RS256') {
      // Asymmetric token (Supabase ES256): verify via JWKS derived from the token's issuer.
      // Works without SUPABASE_URL being explicitly configured.
      const claims = decodeJwt(token);
      const issuer = typeof claims.iss === 'string' ? claims.iss : null;
      if (!issuer) throw new Error('Missing iss claim');

      const { payload } = await jwtVerify(token, getRemoteJwks(issuer), {
        issuer,
        audience: 'authenticated',
      });
      c.set('userId', requireSubject(payload));
    } else {
      // HS256 / symmetric path
      if (!jwtSecret) throw new Error('No JWT secret configured for HS256 token');
      const secret = new TextEncoder().encode(jwtSecret);
      const { payload } = await jwtVerify(token, secret);
      c.set('userId', requireSubject(payload));
    }
  } catch {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  return next();
});
