import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { _resetConfig } from '../src/config.js';

// Mock all services so no DB is needed
vi.mock('../src/services/application.service.js', () => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn().mockResolvedValue({ applications: [], totalCount: 0 }),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));
vi.mock('../src/services/dashboard.service.js', () => ({ getDashboardStats: vi.fn() }));
vi.mock('../src/services/cover-letter.service.js', () => ({}));
vi.mock('../src/services/resume.service.js', () => ({}));
vi.mock('../src/services/project.service.js', () => ({}));
vi.mock('../src/services/dialogue.service.js', () => ({}));
vi.mock('../src/services/catalog.service.js', () => ({}));
vi.mock('../src/services/reports.service.js', () => ({}));
vi.mock('../src/services/resume-variant.service.js', () => ({}));
vi.mock('../src/services/interviewPrep.service.js', () => ({}));
vi.mock('../src/db/client.js', () => ({ db: {} }));

const SHELL = '<!doctype html><html><head><title>Careerpin</title></head><body></body></html>';

/**
 * Stands in for the Cloudflare ASSETS binding with
 * not_found_handling: "single-page-application" — a real file match wins, everything
 * else gets index.html with a 200.
 */
function makeAssets(files: Record<string, string>, spaFallback = true) {
  const fetch = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url);
    if (files[pathname] !== undefined) {
      return new Response(files[pathname], {
        status: 200,
        headers: { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html' },
      });
    }
    if (spaFallback || pathname === '/index.html') {
      return new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response('Not Found', { status: 404 });
  });
  return { fetch };
}

const ASSET_FILES = { '/index.html': SHELL, '/assets/index-abc.js': 'console.log(1)' };

/**
 * Every path-based React Router route a user can land on directly, read out of App.tsx
 * rather than mirrored by hand.
 *
 * The fallback's job is defined entirely by that file: any path React Router can render
 * must get the shell. A hand-kept copy states the same claim but stops being true the
 * first time a route is added and this list is not — silently, because the suite still
 * goes green on the routes it does know. Reading the source of truth makes a new route
 * covered by construction.
 */
const APP_TSX = fileURLToPath(new URL('../../web/src/App.tsx', import.meta.url));
const APP_SOURCE = readFileSync(APP_TSX, 'utf8');

const DECLARED_PATHS = [...APP_SOURCE.matchAll(/\bpath="([^"]*)"/g)].map((m) => m[1]);

// Counting the bare attribute name is independent of how the extractor reads its value,
// so a declaration form this regex cannot parse (path={...}, single quotes) trips the
// parity test below instead of quietly shrinking coverage to the routes it still matches.
const PATH_ATTRIBUTE_COUNT = APP_SOURCE.split(/\bpath=/).length - 1;

/**
 * A stand-in value per `:param`, not one value for all of them.
 *
 * Substituting a single opaque token everywhere reads as a harmless detail and is not:
 * the guard the fallback keys on is the *shape* of the final segment, so a token with no
 * extension makes every derived URL structurally unable to observe it. That is exactly
 * how `/projects/:projectId/files/:fileName` went untested through WIC-1020 — the one
 * route whose URLs carry a dot became the one route the suite could not see.
 *
 * Each sample must therefore be representative of what its route can actually produce,
 * not merely well-formed. `project.service.ts` rejects any `fileName` not ending in
 * `.md`, so a `:fileName` sample without an extension is not a valid URL for that route.
 */
const PARAM_SAMPLES: Record<string, string> = {
  id: '01HZX',
  projectId: 'acme-corp-engineer',
  fileName: 'acme-corp-engineer.md',
};

const DECLARED_PARAMS = [
  ...new Set(DECLARED_PATHS.flatMap((p) => [...p.matchAll(/:([^/]+)/g)].map((m) => m[1]))),
];

// A param added to App.tsx with no sample here would otherwise be substituted with
// nothing in particular and silently tested at a URL its route cannot produce.
const UNSAMPLED_PARAMS = DECLARED_PARAMS.filter((name) => !(name in PARAM_SAMPLES));

function withSampleParams(path: string): string {
  return path.replace(/:([^/]+)/g, (whole, name: string) => PARAM_SAMPLES[name] ?? whole);
}

// A wildcard is the layout wrapper (/*) or the catch-all (*) — neither is a landable
// route, and the catch-all is what renders NotFound once the shell is served.
const CLIENT_ROUTES = [
  ...new Set(DECLARED_PATHS.filter((p) => !p.includes('*')).map(withSampleParams)),
];

// The final segment is what FILE_REQUEST inspects, so a dot anywhere earlier does not
// exercise the guard.
const ROUTES_WITH_EXTENSION = CLIENT_ROUTES.filter((p) => p.split('/').pop()?.includes('.'));

// A browser navigating (address bar, refresh, followed link) sends these. Requests in
// the suite that omit them stand in for subresource fetches and non-browser clients.
const NAVIGATION = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
};

describe('SPA fallback (WIC-1004)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SUPABASE_JWT_SECRET;
    _resetConfig();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfig();
  });

  it('reads every route declaration in App.tsx', () => {
    // Not a floor on the count — an equality against a second, independent count of the
    // same declarations. Dropping or rewording any one of them fails here, where a
    // "more than N routes" assertion would stay green until nearly all of them broke.
    expect(DECLARED_PATHS).toHaveLength(PATH_ATTRIBUTE_COUNT);
    expect(CLIENT_ROUTES).toContain('/');
    expect(CLIENT_ROUTES.every((p) => p.startsWith('/'))).toBe(true);
  });

  it('has a representative sample for every route param App.tsx declares', () => {
    // Named rather than counted: the failure message has to say *which* param went
    // unsampled, because the fix is to add a value that route can really produce.
    expect(UNSAMPLED_PARAMS).toEqual([]);
  });

  it('still covers at least one route whose URL carries an extension', () => {
    // The standing alarm on the WIC-1027 blind spot. `FILE_REQUEST` only fires on a
    // dotted final segment, and the navigation exemption means every request sent with
    // NAVIGATION headers is exempt from it by construction — so the routes below,
    // requested bare, are the only thing in this suite that can observe the guard at
    // all. If App.tsx or PARAM_SAMPLES ever leaves none of them dotted, the suite goes
    // on passing while testing nothing about the file-request path: fail here instead.
    expect(ROUTES_WITH_EXTENSION.length).toBeGreaterThan(0);
  });

  it.each(CLIENT_ROUTES)('serves the SPA shell for %s', async (path) => {
    const app = buildApp();
    const env = { ASSETS: makeAssets(ASSET_FILES) };
    const res = await app.fetch(new Request(`https://app.careerpin.app${path}`), env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    await expect(res.text()).resolves.toContain('<html');
  });

  it('serves the shell for an unknown non-API path so the client renders its own 404', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.careerpin.app/no/such/page'), {
      ASSETS: makeAssets(ASSET_FILES),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('falls back to /index.html if not_found_handling ever drifts off SPA mode', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.careerpin.app/dashboard'), {
      ASSETS: makeAssets(ASSET_FILES, false),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('<html');
  });

  it('does not shadow real static files', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.careerpin.app/assets/index-abc.js'), {
      ASSETS: makeAssets(ASSET_FILES),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('console.log(1)');
  });

  // A cached index.html keeps asking for the hashed bundle it was built against, so
  // during any deploy window the old filename is requested after it stops existing.
  // Answering that with the shell returns 200 for a request that failed: the browser's
  // module MIME check rejects text/html and the page goes blank, while logs show a 200.
  it.each([
    ['/assets/index-STALE.js', 'a stale hashed bundle'],
    ['/assets/index-STALE.css', 'a stale hashed stylesheet'],
    ['/favicon.ico', 'a missing icon'],
    ['/robots.txt', 'a missing text file'],
  ])('404s %s (%s) instead of serving the shell', async (path) => {
    const app = buildApp();
    const res = await app.fetch(new Request(`https://app.careerpin.app${path}`), {
      ASSETS: makeAssets(ASSET_FILES),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type') ?? '').not.toContain('text/html');
  });

  // /projects/:projectId/files/:fileName is a real React Router route and dialogue
  // capture names the file `${company}-${role}.md`, so a legitimate deep link ends in an
  // extension. Refusing it on the extension alone reinstates the exact WIC-1004 P1 —
  // refresh on a project file page returns a plaintext 404 — for that whole route.
  const PROJECT_FILE = '/projects/acme-corp-engineer/files/acme-corp-engineer.md';

  it.each([
    [PROJECT_FILE, 'a generated dialogue file'],
    ['/projects/acme-corp/files/notes.v2.md', 'a name with more than one dot'],
    ['/projects/acme-corp/files/design.png', 'an asset-shaped file name under a route'],
  ])('serves the shell when a browser navigates to %s (%s)', async (path) => {
    const app = buildApp();
    const res = await app.fetch(
      new Request(`https://app.careerpin.app${path}`, { headers: NAVIGATION }),
      { ASSETS: makeAssets(ASSET_FILES) }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    await expect(res.text()).resolves.toContain('<html');
  });

  it('serves the shell for a project-file deep link when not_found_handling has drifted', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request(`https://app.careerpin.app${PROJECT_FILE}`, { headers: NAVIGATION }),
      { ASSETS: makeAssets(ASSET_FILES, false) }
    );

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('<html');
  });

  // The navigation exemption must not become a hole in the defect-#1 fix: the same path
  // requested as a subresource is still a miss and must still 404.
  it.each([
    ['script', 'the shell asking for a stale bundle'],
    ['style', 'a stylesheet fetch'],
    ['image', 'an <img> fetch'],
  ])('still 404s a missing file fetched as Sec-Fetch-Dest: %s (%s)', async (dest) => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://app.careerpin.app/assets/index-STALE.js', {
        headers: { Accept: '*/*', 'Sec-Fetch-Dest': dest, 'Sec-Fetch-Mode': 'cors' },
      }),
      { ASSETS: makeAssets(ASSET_FILES) }
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type') ?? '').not.toContain('text/html');
  });

  // A browser that predates Sec-Fetch-* still identifies a navigation by Accept.
  it('serves the shell for a project-file deep link with only an Accept header', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request(`https://app.careerpin.app${PROJECT_FILE}`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      }),
      { ASSETS: makeAssets(ASSET_FILES) }
    );

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('<html');
  });

  // Sec-Fetch-* wins over Accept when both are present, so a subresource fetch that
  // happens to advertise text/html cannot talk its way past the guard.
  it('404s a missing file whose Accept says html but whose Sec-Fetch-Dest says script', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://app.careerpin.app/assets/index-STALE.js', {
        headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'script', 'Sec-Fetch-Mode': 'cors' },
      }),
      { ASSETS: makeAssets(ASSET_FILES) }
    );

    expect(res.status).toBe(404);
  });

  it('404s a missing file request when not_found_handling has drifted off SPA mode', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.careerpin.app/assets/gone-abc.js'), {
      ASSETS: makeAssets(ASSET_FILES, false),
    });

    expect(res.status).toBe(404);
  });

  it.each(['/api/health', '/api/applications', '/api/nope'])(
    'keeps %s on JSON — never the SPA shell',
    async (path) => {
      const app = buildApp();
      const assets = makeAssets(ASSET_FILES);
      const res = await app.fetch(new Request(`https://app.careerpin.app${path}`), {
        ASSETS: assets,
      });

      expect(res.headers.get('Content-Type')).toContain('application/json');
      expect(assets.fetch).not.toHaveBeenCalled();
    }
  );

  it('returns JSON 404 for an unknown API path', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.careerpin.app/api/nope'), {
      ASSETS: makeAssets(ASSET_FILES),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  it('does not serve the shell for non-GET requests', async () => {
    const app = buildApp();
    const assets = makeAssets(ASSET_FILES);
    const res = await app.fetch(
      new Request('https://app.careerpin.app/dashboard', { method: 'POST' }),
      { ASSETS: assets }
    );

    expect(res.status).toBe(404);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it('degrades to a plain 404 when no ASSETS binding exists (Node dev)', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://localhost:3000/dashboard'), {});

    expect(res.status).toBe(404);
  });

  // The navigation exemption is what lets /projects/:id/files/:fileName survive the
  // file-shaped guard. It must not extend to the build's own namespace: a stale bundle
  // answered 200 + HTML is the deploy-skew blind spot, and it is no less a blind spot
  // because the client happened to look like a navigation.
  describe('build-owned paths are refused regardless of request type', () => {
    it.each([
      ['a stale bundle opened in the address bar', { 'Sec-Fetch-Dest': 'document' }],
      ['a stale bundle fetched by a cached index.html', { 'Sec-Fetch-Dest': 'script' }],
      ['an uptime probe that asks for html', { Accept: 'text/html,*/*' }],
      ['a client that sends no hints at all', {}],
    ])('404s %s', async (_label, headers) => {
      const app = buildApp();
      const res = await app.fetch(
        new Request('https://app.careerpin.app/assets/index-STALE.js', { headers }),
        { ASSETS: makeAssets(ASSET_FILES) }
      );

      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type') ?? '').not.toContain('text/html');
    });

    it('404s an unbuilt root static file even on a navigation', async () => {
      const app = buildApp();
      const res = await app.fetch(
        new Request('https://app.careerpin.app/favicon.svg', {
          headers: { 'Sec-Fetch-Dest': 'document', Accept: 'text/html' },
        }),
        { ASSETS: makeAssets({ '/index.html': SHELL }) }
      );

      expect(res.status).toBe(404);
    });

    it('still serves a real asset that exists', async () => {
      const app = buildApp();
      const res = await app.fetch(
        new Request('https://app.careerpin.app/assets/index-abc.js', {
          headers: { 'Sec-Fetch-Dest': 'script' },
        }),
        { ASSETS: makeAssets(ASSET_FILES) }
      );

      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe('console.log(1)');
    });

    it('does not swallow a project-file deep link whose name mentions assets', async () => {
      const app = buildApp();
      const res = await app.fetch(
        new Request('https://app.careerpin.app/projects/acme/files/assets-plan.md', {
          headers: { 'Sec-Fetch-Dest': 'document' },
        }),
        { ASSETS: makeAssets(ASSET_FILES) }
      );

      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toContain('<html');
    });
  });
});
