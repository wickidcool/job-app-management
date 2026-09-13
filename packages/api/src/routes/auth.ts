import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { AppError } from '../types/index.js';
import type { AppEnv } from '../types/env.js';
import { readJsonBody } from '../lib/request.js';

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
    const parsed = registerSchema.safeParse(await readJsonBody(c));
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
    const parsed = loginSchema.safeParse(await readJsonBody(c));
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
  /**
   * WIC-2383 — answer from the token `authMiddleware` already verified.
   *
   * ⛔ Do NOT reach for `supabase.auth.admin.*` here. This route used to call
   * `admin.getUserById(userId)` on a client built from `SUPABASE_ANON_KEY`, and
   * the GoTrue admin API rejects an anon/publishable key outright (`401
   * no_authorization`). The call therefore failed on **every** request in every
   * deployment, and the `if (error) -> 404` below it turned that into a flat
   * `404 User not found` for a caller whose JWT had just verified cleanly.
   *
   * It is not fixable by configuration: this repo provisions no service-role key
   * anywhere — not in `types/env.ts`, not in `config.ts`, not in any workflow —
   * and it should not start. A service-role key bypasses RLS entirely, so
   * shipping one to the Worker to satisfy a session-hydration endpoint would
   * trade ADR-005's isolation guarantee for a field the token already carries.
   *
   * The cost of the old shape was a broken session across page loads:
   * `AuthContext.fetchCurrentUser` calls this on mount with the stored token, and
   * treats a non-2xx as "session invalid" — so it cleared `auth_token` and
   * bounced the user to `/login` on every refresh and every full navigation. It
   * survived unnoticed because every E2E spec in the repo mocks `/api/auth/me`;
   * the WIC-2122 live-backend isolation tier is the first test to call it for
   * real, and it failed there immediately.
   *
   * There is no Supabase round trip here by design. The middleware has already
   * verified the signature, issuer and expiry, so re-fetching the user would add
   * a network hop to re-derive claims we hold — and would reintroduce a failure
   * mode on a path that must not have one.
   */
  .get('/auth/me', async (c) => {
    const userId = c.get('userId');
    if (!userId) throw new AppError('UNAUTHORIZED', 'Not authenticated', undefined, 401);

    // `email` is optional: the local-dev bypass has no token, and a verified
    // token may legally omit the claim. Report that as `null` rather than
    // failing the request — `userId` is the identity, this is a display field,
    // and the web client already renders a falsy email as "User".
    return c.json({ user: { id: userId, email: c.get('userEmail') ?? null } });
  });
