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

// Every path-based React Router route a user can land on directly (App.tsx).
const CLIENT_ROUTES = [
  '/',
  '/login',
  '/dashboard',
  '/applications',
  '/applications/new',
  '/applications/01HZX/prep',
  '/catalog',
  '/cover-letters/new',
  '/cover-letters/01HZX',
  '/resumes/exports',
  '/reports/pipeline',
  '/settings',
  '/projects',
  '/projects/new/dialogue',
  '/projects/acme-corp-engineer',
];

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
});
