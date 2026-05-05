import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { jwtVerify } from 'jose';
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

  fastify.addHook('onRequest', async (request, reply) => {
    // Bypass auth when SUPABASE_JWT_SECRET is not set (local dev without Supabase)
    if (!config.supabaseJwtSecret) {
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
      const secret = new TextEncoder().encode(config.supabaseJwtSecret);
      const { payload } = await jwtVerify(token, secret);
      request.userId = (payload.sub as string) ?? null;
    } catch {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
      });
    }
  });
};

// fp() escapes Fastify's scope encapsulation so the hook applies to sibling plugins
export const authPlugin = fp(authPluginImpl);
