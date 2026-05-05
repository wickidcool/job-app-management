import type { FastifyPluginAsync } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { AppError } from '../types/index.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const config = getConfig();

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    fastify.log.warn('Supabase not configured — auth routes disabled');
    return;
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  fastify.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten(), 400);
    }

    const { email, password } = parsed.data;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      throw new AppError('AUTH_ERROR', error.message, undefined, 400);
    }

    if (!data.session) {
      return reply.status(200).send({
        message: 'Check your email for a confirmation link',
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
      });
    }

    return reply.status(201).send({
      token: data.session.access_token,
      user: {
        id: data.user!.id,
        email: data.user!.email,
      },
    });
  });

  fastify.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten(), 400);
    }

    const { email, password } = parsed.data;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new AppError('AUTH_ERROR', error.message, undefined, 401);
    }

    return reply.status(200).send({
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  });

  fastify.post('/auth/logout', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      await supabase.auth.signOut();
    }
    return reply.status(204).send();
  });

  fastify.get('/auth/me', async (request, reply) => {
    if (!request.userId) {
      throw new AppError('UNAUTHORIZED', 'Not authenticated', undefined, 401);
    }

    const { data, error } = await supabase.auth.admin.getUserById(request.userId);

    if (error || !data.user) {
      throw new AppError('NOT_FOUND', 'User not found', undefined, 404);
    }

    return reply.status(200).send({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  });
};
