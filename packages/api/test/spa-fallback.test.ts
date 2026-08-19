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

const SPA_SHELL = '<!doctype html><html><div id="root"></div></html>';

/** Stand-in for the Cloudflare `ASSETS` binding. */
function assetsStub() {
  const fetch = vi.fn(async (input: Request | URL | string) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/') {
      return new Response(SPA_SHELL, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('404 Not Found', { status: 404 });
  });
  return { fetch } as unknown as Fetcher & { fetch: ReturnType<typeof vi.fn> };
}

describe('SPA deep-link fallback (WIC-1004)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    _resetConfig();
    // Auth off, so an unmatched /api/* path is a genuine 404 rather than a 401.
    process.env = { ...originalEnv, SUPABASE_JWT_SECRET: undefined };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('client-side routes serve the SPA shell', () => {
    // The routes QA reproduced as plaintext 404s in production.
    it.each(['/dashboard', '/dashboard/', '/login', '/applications'])(
      'serves index.html for %s',
      async (path) => {
        const app = buildApp();
        const ASSETS = assetsStub();

        const res = await app.request(path, { method: 'GET' }, { ASSETS });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        await expect(res.text()).resolves.toBe(SPA_SHELL);
      }
    );

    it('requests the shell at / regardless of the deep-link path', async () => {
      const app = buildApp();
      const ASSETS = assetsStub();

      await app.request('/applications/01H0000000000000000000', { method: 'GET' }, { ASSETS });

      expect(ASSETS.fetch).toHaveBeenCalledTimes(1);
      const requested = ASSETS.fetch.mock.calls[0][0] as Request;
      expect(new URL(requested.url).pathname).toBe('/');
    });
  });

  describe('API paths must never receive the SPA shell', () => {
    // This is the regression guard: HTML served to an API caller would break every
    // client fetch, which is a worse failure than the 404 being fixed.
    it.each(['/api/does-not-exist', '/api/applications/nope/deeper'])(
      'returns JSON 404 for %s',
      async (path) => {
        const app = buildApp();
        const ASSETS = assetsStub();

        const res = await app.request(path, { method: 'GET' }, { ASSETS });

        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toContain('application/json');
        await expect(res.json()).resolves.toEqual({
          error: { code: 'NOT_FOUND', message: 'Not found' },
        });
        expect(ASSETS.fetch).not.toHaveBeenCalled();
      }
    );
  });

  describe('degraded environments', () => {
    it('falls back to a plain 404 when the ASSETS binding is absent', async () => {
      // The Node.js dev entry point has no asset server bound.
      const app = buildApp();

      const res = await app.request('/dashboard', { method: 'GET' }, {});

      expect(res.status).toBe(404);
    });

    it('does not serve a broken shell when the asset fetch fails', async () => {
      const app = buildApp();
      const ASSETS = {
        fetch: vi.fn(async () => new Response('boom', { status: 500 })),
      } as unknown as Fetcher;

      const res = await app.request('/dashboard', { method: 'GET' }, { ASSETS });

      expect(res.status).toBe(404);
    });
  });
});
