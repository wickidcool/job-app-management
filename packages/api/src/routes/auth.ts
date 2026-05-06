import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { AppError } from '../types/index.js';
import type { AppEnv } from '../types/env.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const authRoutes = new Hono<AppEnv>()
  .post('/auth/register', async (c) => {
    const config = getConfig();
    const supabaseUrl = (c.env?.SUPABASE_URL as string | undefined) ?? config.supabaseUrl;
    const supabaseAnonKey =
      (c.env?.SUPABASE_ANON_KEY as string | undefined) ?? config.supabaseAnonKey;

    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Auth not configured' } }, 503);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const parsed = registerSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten(), 400);
    }

    const { email, password } = parsed.data;
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) throw new AppError('AUTH_ERROR', error.message, undefined, 400);

    if (!data.session) {
      return c.json(
        {
          message: 'Check your email for a confirmation link',
          user: data.user ? { id: data.user.id, email: data.user.email } : null,
        },
        200
      );
    }

    return c.json(
      { token: data.session.access_token, user: { id: data.user!.id, email: data.user!.email } },
      201
    );
  })
  .post('/auth/login', async (c) => {
    const config = getConfig();
    const supabaseUrl = (c.env?.SUPABASE_URL as string | undefined) ?? config.supabaseUrl;
    const supabaseAnonKey =
      (c.env?.SUPABASE_ANON_KEY as string | undefined) ?? config.supabaseAnonKey;

    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Auth not configured' } }, 503);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const parsed = loginSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten(), 400);
    }

    const { email, password } = parsed.data;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) throw new AppError('AUTH_ERROR', error.message, undefined, 401);

    return c.json({
      token: data.session.access_token,
      user: { id: data.user.id, email: data.user.email },
    });
  })
  .post('/auth/logout', async (c) => {
    const config = getConfig();
    const supabaseUrl = (c.env?.SUPABASE_URL as string | undefined) ?? config.supabaseUrl;
    const supabaseAnonKey =
      (c.env?.SUPABASE_ANON_KEY as string | undefined) ?? config.supabaseAnonKey;

    if (supabaseUrl && supabaseAnonKey) {
      const authHeader = c.req.header('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        await supabase.auth.signOut();
      }
    }
    return c.body(null, 204);
  })
  .get('/auth/me', async (c) => {
    const userId = c.get('userId');
    if (!userId) throw new AppError('UNAUTHORIZED', 'Not authenticated', undefined, 401);

    const config = getConfig();
    const supabaseUrl = (c.env?.SUPABASE_URL as string | undefined) ?? config.supabaseUrl;
    const supabaseAnonKey =
      (c.env?.SUPABASE_ANON_KEY as string | undefined) ?? config.supabaseAnonKey;

    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Auth not configured' } }, 503);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.admin.getUserById(userId);

    if (error || !data.user) throw new AppError('NOT_FOUND', 'User not found', undefined, 404);

    return c.json({ user: { id: data.user.id, email: data.user.email } });
  });
