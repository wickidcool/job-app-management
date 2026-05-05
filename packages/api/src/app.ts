import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { getDb } from './db/client.js';
import { applicationsRoutes } from './routes/applications.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { coverLettersRoutes } from './routes/cover-letters.js';
import { resumesRoutes } from './routes/resumes.js';
import { projectsRoutes } from './routes/projects.js';
import { dialogueRoutes } from './routes/dialogue.routes.js';
import { catalogRoutes } from './routes/catalog.routes.js';
import { reportsRoutes } from './routes/reports.js';
import { resumeVariantsRoutes } from './routes/resume-variants.js';
import { interviewPrepsRoutes } from './routes/interview-preps.js';
import { authRoutes } from './routes/auth.js';
import { authMiddleware } from './middleware/auth.js';
import { AppError } from './types/index.js';
import type { AppEnv } from './types/env.js';

export function buildApp() {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    })
  );

  app.get('/health', async (c) => {
    const hyperdrive = !!c.env?.HYPERDRIVE;
    // Only probe the DB when the HYPERDRIVE binding is present (Workers context).
    // In local/test contexts there's no binding and no live DB to test.
    let db: 'ok' | 'not_applicable' | string = 'not_applicable';
    if (hyperdrive) {
      try {
        await getDb().execute(sql`SELECT 1`);
        db = 'ok';
      } catch (err) {
        db = err instanceof Error ? err.message : String(err);
      }
    }
    const status = db === 'ok' || db === 'not_applicable' ? 'ok' : 'degraded';
    return c.json({ status, hyperdrive, db }, status === 'ok' ? 200 : 503);
  });

  const api = new Hono<AppEnv>();
  api.use('*', authMiddleware);
  api.route('/', authRoutes);
  api.route('/', applicationsRoutes);
  api.route('/', dashboardRoutes);
  api.route('/', coverLettersRoutes);
  api.route('/', resumesRoutes);
  api.route('/', projectsRoutes);
  api.route('/', dialogueRoutes);
  api.route('/', catalogRoutes);
  api.route('/', reportsRoutes);
  api.route('/', resumeVariantsRoutes);
  api.route('/', interviewPrepsRoutes);

  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.statusCode as 400 | 401 | 403 | 404 | 409 | 415 | 429 | 500 | 501 | 503
      );
    }

    console.error(err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      500
    );
  });

  return app;
}
