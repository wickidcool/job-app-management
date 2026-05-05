import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
  const config = getConfig();

  fastify.decorateRequest('userId', null);

  const publicRoutes = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'];

  // Supabase now signs JWTs with ES256 (asymmetric). Verify via JWKS so we
  // accept the token regardless of which key Supabase rotates to in future.
  // Fall back to the symmetric secret only when no Supabase URL is configured.
  const jwks = config.supabaseUrl
    ? createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`))
    : null;

  fastify.addHook('onRequest', async (request, reply) => {
    // Bypass auth entirely in local dev when neither Supabase URL nor secret is set
    if (!jwks && !config.supabaseJwtSecret) {
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
      if (jwks) {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: `${config.supabaseUrl}/auth/v1`,
          audience: 'authenticated',
        });
        request.userId = (payload.sub as string) ?? null;
      } else {
        // Symmetric fallback for environments without a Supabase URL
        const secret = new TextEncoder().encode(config.supabaseJwtSecret!);
        const { payload } = await jwtVerify(token, secret);
        request.userId = (payload.sub as string) ?? null;
      }
    } catch {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
      });
    }
  });
};

// fp() escapes Fastify's scope encapsulation so the hook applies to sibling plugins
export const authPlugin = fp(authPluginImpl);
