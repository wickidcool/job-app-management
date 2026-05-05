import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import type { AppEnv } from '../types/env.js';
import { getConfig } from '../config.js';

const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'];

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const jwtSecret = (c.env?.SUPABASE_JWT_SECRET as string | undefined) ?? getConfig().supabaseJwtSecret;

  if (!jwtSecret) {
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
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    c.set('userId', (payload.sub as string) ?? null);
  } catch {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  return next();
});
