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
      c.set('userId', (payload.sub as string) ?? null);
    } else {
      // HS256 / symmetric path
      if (!jwtSecret) throw new Error('No JWT secret configured for HS256 token');
      const secret = new TextEncoder().encode(jwtSecret);
      const { payload } = await jwtVerify(token, secret);
      c.set('userId', (payload.sub as string) ?? null);
    }
  } catch {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  return next();
});
