import { Hono } from 'hono';
import type { Context } from 'hono';
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
import { httpsRedirect, securityHeaders } from './middleware/security.js';
import { AppError } from './types/index.js';
import type { AppEnv } from './types/env.js';
import { isHyperdriveTimeout, isSubrequestExhaustion } from './db/hyperdrive.js';
import { withConnectBudget } from './db/connect-budget.js';

/**
 * Extensions the asset pipeline actually serves. A dotted path outside this set is a
 * client route, not a file request.
 *
 * Matching *any* dot is wider than the deploy-skew defect needs, and that extra width is
 * what swallowed /projects/:projectId/files/:fileName — project.service.ts rejects a
 * fileName that does not end in .md, so every URL that route can produce carries a dot.
 * .md is deliberately absent here; .txt/.json are safe because toSlug() collapses
 * [^a-z0-9]+ to '-', so only the filename segment of that route can carry one.
 */
const FILE_REQUEST =
  /\.(?:js|mjs|cjs|css|map|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|json|txt|xml|webmanifest|wasm)$/i;

/**
 * Paths the build owns outright. Vite emits every hashed bundle under /assets/, and
 * packages/web/public holds the only root-level static files, so this namespace is
 * enumerable rather than guessed.
 *
 * Nothing here is ever a client-side route, so a miss is a miss however the request was
 * made — the navigation exemption below must not reach it. A stale bundle URL opened in
 * the address bar, or an uptime probe that sends Accept: text/html, would otherwise be
 * answered 200 + HTML: the same deploy-skew blind spot this guard exists to prevent,
 * merely narrowed to navigating clients.
 */
const STATIC_ROOT_FILES = new Set(['/favicon.svg', '/icons.svg']);

function isBuildOwnedPath(pathname: string): boolean {
  return pathname.startsWith('/assets/') || STATIC_ROOT_FILES.has(pathname);
}

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

  // Transport hardening first (WIC-1011): headers wrap every response including the
  // redirect, and cleartext requests are turned away before any handler runs.
  app.use('*', securityHeaders());
  app.use('*', httpsRedirect());

  app.use(
    '*',
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    })
  );

  // Liveness that actually reaches Postgres, served with NO auth (WIC-1296). It runs a
  // real `SELECT 1`, so a paused/unreachable database makes it go `503 degraded` — unlike
  // the authenticated `/api/*` routes, which return 401 before touching the DB and can
  // therefore never register a database outage. Registered on BOTH `/health` and
  // `/api/health`: the `/api/health` handler is declared here, before `app.route('/api',
  // api)` mounts the auth-guarded sub-app, so it wins the match and is not shadowed by
  // `authMiddleware`. Callers that (reasonably) assumed `/api/health` was a health check
  // were previously getting a bare 401; now they get a genuine DB liveness signal.
  const healthHandler = async (c: Context<AppEnv>) => {
    const hyperdrive = !!c.env?.HYPERDRIVE;
    const hasDbUrl = !!c.env?.DATABASE_URL;
    // Only probe the DB when a Workers DB binding is present.
    // In local/test contexts neither binding exists — skip the probe.
    let db: 'ok' | 'not_applicable' | string = 'not_applicable';
    if (hyperdrive || hasDbUrl) {
      try {
        // WIC-1916: bound the probe on a wall clock and tear the pool down on
        // failure. Without this, a `DATABASE_URL`-only prod (no Hyperdrive) would
        // let the `SELECT 1` spin postgres-js's ceiling-less initial-dial loop and
        // report the opaque "Too many subrequests" after 8–14s instead of the real
        // connect error — and would trip the isolate breaker so sibling requests in
        // the same warm Worker fail fast rather than each re-draining the budget.
        await withConnectBudget(() => getDb().execute(sql`SELECT 1`));
        db = 'ok';
      } catch (err) {
        db = err instanceof Error ? err.message : String(err);
      }
    }
    const status = db === 'ok' || db === 'not_applicable' ? 'ok' : 'degraded';
    return c.json({ status, hyperdrive, db }, status === 'ok' ? 200 : 503);
  };
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

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

    // A subresource fetch for a path ending in a served extension is asking for a file,
    // not a React Router route — the asset router already tried it and missed. Handing it
    // the shell would answer 200 to a request that failed: a stale hashed bundle still
    // referenced by a cached index.html would blank the page on the browser's module MIME
    // check instead of failing cleanly, and would never surface as a 404 in monitoring.
    // Two independent reasons to refuse: the path belongs to the build (never a route, so
    // headers are irrelevant), or its extension is one the pipeline serves and the request
    // is a subresource fetch rather than a navigation. A navigating client is exempt from
    // the second because an .html-serving extension can still front a route.
    const refuseShell =
      isBuildOwnedPath(url.pathname) || (FILE_REQUEST.test(url.pathname) && !isNavigation(headers));
    if (refuseShell) {
      // Under SPA handling a miss comes back as the shell with 200, so a status check
      // alone cannot see it — an HTML answer to a non-HTML file request is that miss.
      // No .html exemption is needed: .html is not in FILE_REQUEST, and the build emits
      // no .html under the paths isBuildOwnedPath claims, so nothing that legitimately
      // answers text/html reaches here.
      const servedShell = (res.headers.get('Content-Type') ?? '').includes('text/html');
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

    // Also re-throw when the invocation ran out of subrequests, so worker.ts
    // answers 503 once instead of this handler reporting an opaque 500 on every
    // DB-backed endpoint. It is an availability failure, not a bug in the route.
    if (isSubrequestExhaustion(err)) throw err;

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
