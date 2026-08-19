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

// A last path segment containing a dot usually means the caller wants a file
// (/assets/x-abc.js, /favicon.ico) rather than a client-side route. It is only a hint:
// /projects/:projectId/files/:fileName resolves to a real deep link ending in .md,
// so this must never be the sole reason to refuse the shell — see isNavigation.
const FILE_REQUEST = /\/[^/]+\.[^/]+$/;

/**
 * True when the request is a top-level document navigation — an address-bar entry,
 * a refresh, or a followed link — rather than a subresource fetch.
 *
 * This is what separates the two failure modes the fallback has to tell apart. The
 * <script> tag in a cached index.html asking for its hashed bundle is a subresource
 * (Sec-Fetch-Dest: script) and must fail loudly; a user refreshing on
 * /projects/acme/files/acme-notes.md is a navigation that must get the SPA shell even
 * though its last segment carries an extension.
 *
 * Every browser that can run the SPA sends Sec-Fetch-*. Clients that do not (curl,
 * uptime probes) fall back to Accept, which a navigating browser sets to text/html.
 */
function isNavigation(headers: Headers): boolean {
  const dest = headers.get('Sec-Fetch-Dest');
  const mode = headers.get('Sec-Fetch-Mode');
  if (dest !== null || mode !== null) return dest === 'document' || mode === 'navigate';
  return (headers.get('Accept') ?? '').includes('text/html');
}

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

  // SPA fallback (WIC-1004). Static files are served by the asset router before the
  // Worker runs, so anything reaching here is either an unknown API path or a
  // client-side React Router route (/dashboard, /applications/:id, ...). API paths must
  // keep returning JSON — only non-API requests get the SPA shell.
  app.notFound(async (c) => {
    const url = new URL(c.req.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }, 404);
    }

    const assets = c.env?.ASSETS;
    const method = c.req.method;
    if (!assets || (method !== 'GET' && method !== 'HEAD')) {
      return c.text('Not Found', 404);
    }

    // not_found_handling: "single-page-application" makes this return index.html, but
    // retry the shell explicitly so the fallback holds even if that setting drifts.
    const headers = c.req.raw.headers;
    let res = await assets.fetch(new Request(url, { method: 'GET', headers }));

    // A subresource fetch for a path whose last segment carries an extension is asking
    // for a file, not a React Router route — the asset router already tried it and
    // missed. Handing it the shell would answer 200 to a request that failed: a stale
    // hashed bundle still referenced by a cached index.html would blank the page on the
    // browser's module MIME check instead of failing cleanly, and would never surface as
    // a 404 in monitoring. A navigation is excluded because a deep link is allowed to end
    // in an extension (/projects/:projectId/files/:fileName) and must still get the shell.
    if (FILE_REQUEST.test(url.pathname) && !isNavigation(headers)) {
      // Under SPA handling a miss comes back as the shell with 200, so a status check
      // alone cannot see it — an HTML answer to a non-HTML file request is that miss.
      const servedShell =
        (res.headers.get('Content-Type') ?? '').includes('text/html') &&
        !url.pathname.endsWith('.html');
      return res.status === 404 || servedShell ? c.text('Not Found', 404) : res;
    }

    if (res.status === 404) {
      res = await assets.fetch(
        new Request(new URL('/index.html', url), { method: 'GET', headers })
      );
    }
    return res.status === 404 ? c.text('Not Found', 404) : res;
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
