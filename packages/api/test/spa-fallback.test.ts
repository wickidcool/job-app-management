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
];

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
      const res = await app.fetch(new Request(`https://app.careerpin.app${path}`), { ASSETS: assets });

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
