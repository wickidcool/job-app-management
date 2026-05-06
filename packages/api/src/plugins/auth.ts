import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { getConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

// Cache JWKS keyed by issuer so we don't reconstruct the fetcher per request
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRemoteJwks(issuer: string) {
  if (!jwksCache.has(issuer)) {
    jwksCache.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  }
  return jwksCache.get(issuer)!;
}

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
  const config = getConfig();

  fastify.decorateRequest('userId', null);

  const publicRoutes = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'];

  fastify.addHook('onRequest', async (request, reply) => {
    // Bypass auth entirely when no Supabase config is present (local dev without auth)
    if (!config.supabaseUrl && !config.supabaseJwtSecret) {
      return;
    }

    // Skip auth for public routes
    if (publicRoutes.includes(request.url.split('?')[0])) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' },
      });
    }

    const token = authHeader.slice(7);

    try {
      const header = decodeProtectedHeader(token);

      if (header.alg === 'ES256' || header.alg === 'RS256') {
        // Asymmetric token (Supabase ES256): verify via JWKS derived from the token's issuer.
        // This works even when SUPABASE_URL is not explicitly set in .env.
        const claims = decodeJwt(token);
        const issuer = typeof claims.iss === 'string' ? claims.iss : null;
        if (!issuer) throw new Error('Missing iss claim');

        const { payload } = await jwtVerify(token, getRemoteJwks(issuer), {
          issuer,
          audience: 'authenticated',
        });
        request.userId = (payload.sub as string) ?? null;
      } else {
        // HS256 / symmetric path — requires SUPABASE_JWT_SECRET
        if (!config.supabaseJwtSecret) throw new Error('No symmetric secret configured');
        const secret = new TextEncoder().encode(config.supabaseJwtSecret);
        const { payload } = await jwtVerify(token, secret);
        request.userId = (payload.sub as string) ?? null;
      }
    } catch (err) {
      request.log.warn({ err }, 'JWT verification failed');
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
      });
    }
  });
};

// fp() escapes Fastify's scope encapsulation so the hook applies to sibling plugins
export const authPlugin = fp(authPluginImpl);
