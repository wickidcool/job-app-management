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
import { onboardingRoutes } from './routes/onboarding.js';
import { personalInfoRoutes } from './routes/personal-info.js';
import { authRoutes } from './routes/auth.js';
import { authMiddleware } from './middleware/auth.js';
import { AppError } from './types/index.js';
import type { AppEnv } from './types/env.js';
import { isHyperdriveTimeout } from './db/hyperdrive.js';

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
    const hasDbUrl = !!c.env?.DATABASE_URL;
    // Only probe the DB when a Workers DB binding is present.
    // In local/test contexts neither binding exists — skip the probe.
    let db: 'ok' | 'not_applicable' | string = 'not_applicable';
    if (hyperdrive || hasDbUrl) {
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
  api.route('/', onboardingRoutes);
  api.route('/', personalInfoRoutes);

  app.route('/api', api);

  // Unmatched paths land here. `assets.not_found_handling` in wrangler.jsonc cannot help:
  // worker.ts hands every request to Hono, so a path with no matching static file reaches
  // the app and would otherwise get Hono's default plaintext 404 (WIC-1004).
  app.notFound(async (c) => {
    const url = new URL(c.req.url);

    // API paths must keep answering JSON — they must never fall through to the SPA shell.
    if (url.pathname.startsWith('/api/')) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }

    // Anything else is a client-side route: serve index.html so React Router can resolve it
    // on direct navigation, refresh or a shared deep link.
    const assets = c.env.ASSETS;
    if (!assets) return c.text('Not Found', 404);

    const shell = await assets.fetch(new Request(new URL('/', url)));
    return shell.ok ? shell : c.text('Not Found', 404);
  });

  app.onError((err, c) => {
    // Re-throw so worker.ts can retry with a fresh Hyperdrive connection.
    if (isHyperdriveTimeout(err)) throw err;

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
