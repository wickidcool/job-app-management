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
 * The genuine dev bypass is a different branch — the `!supabaseUrl &&
 * !jwtSecret` early return above. Its *condition* is untouched by this guard
 * and by ADR-010 D3 alike; what D3 changed is that it now supplies the
 * `LOCAL_DEV_USER_ID` sentinel rather than `null`, retiring ADR-003's
 * "left as null for local-only" affordance. So after D3 there is no path
 * through this middleware that admits a request with no owner: this one 401s,
 * and the bypass resolves a real tenant.
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
  // WIC-2191 — `||`, not `??`, on both: `??` falls back only on `null`/`undefined`,
  // so a binding that is *present but empty* won the coalesce as `''`. `''` is
  // falsy, so the bypass condition below read TRUE and returned `next()` above the
  // `Authorization` check — an unauthenticated request served as the sentinel
  // tenant, in a deployment whose config was set correctly the whole time.
  //
  // Blank is the realistic shape, not a contrivance: an Actions expression for a
  // missing secret expands to the empty string, and `wrangler secret put` stores
  // it and reports success (`set-worker-secrets.yml:96-101`; already observed on
  // `ANTHROPIC_API_KEY`, run 33972091515).
  //
  // Deliberately NOT `?.trim() ||`, which is the idiom two lines below at :77 and
  // the wrong one here. There the fallback is a safe sentinel; here it decides
  // whether auth runs at all. `'   '` is truthy, so a whitespace-only binding
  // currently takes the JWT path and 401s — fail-CLOSED. Trimming would collapse
  // it to `''` and open the bypass, and `deploy.yml`'s `[ -z "$X" ]` guard does
  // not reject whitespace-only, so that is precisely the input CI cannot catch.
  // Not trimming also leaves `jwtSecret` untouched as HS256 key material.
  const supabaseUrl = (c.env?.SUPABASE_URL as string | undefined) || getConfig().supabaseUrl;
  const jwtSecret =
    (c.env?.SUPABASE_JWT_SECRET as string | undefined) || getConfig().supabaseJwtSecret;

  // Bypass when no Supabase config is present (local dev without auth).
  //
  // ADR-010 D3 — the bypass supplies a *real owner*, not an absence. Local dev
  // is therefore "one specific tenant" rather than "no tenant", so every
  // tenancy predicate downstream runs its owner branch here exactly as it does
  // in production, instead of being skipped. That is the point: it is what
  // makes local dev and E2E exercise the isolation logic rather than bypass it.
  //
  // The *condition* is deliberately untouched — D3 changes what the bypass
  // supplies, never when it fires. A deployment with either variable set still
  // takes the JWT path below and still 401s on a missing or invalid token.
  if (!supabaseUrl && !jwtSecret) {
    // `||`, not `??`: a blank binding must fall through to the configured
    // default rather than resolve to `''`, which `requireOwner` rejects.
    c.set('userId', c.env?.LOCAL_DEV_USER_ID?.trim() || getConfig().localDevUserId);
    return next();
  }

  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.includes(path)) {
    // Deliberately leaves `userId` unset rather than setting it to `null`
    // (ADR-010 D1.2). These three routes run before an owner exists — logging in
    // is how you get one — so there is no owner to record, and `HonoVariables`
    // no longer admits `null` as a way to say so.
    //
    // Downstream this is the same absence it always was: `c.get('userId')`
    // returns `undefined` instead of `null`, and every consumer tests it with
    // `!userId` or through `requireOwner`, both of which treat the two
    // identically. No guarded route is reachable here — `PUBLIC_PATHS` is
    // exactly `/api/auth/{login,register,logout}`, and `/auth/me` is not in it.
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
