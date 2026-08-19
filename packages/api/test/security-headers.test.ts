import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { _resetConfig } from '../src/config.js';

// Mock every service so the app builds without a DB.
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

const APP_HOST = 'https://app.careerpin.app';

const EXPECTED_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'none'",
};

/** A request that arrived at the edge over cleartext, as Cloudflare presents it. */
function cleartext(path: string, init: RequestInit = {}) {
  return new Request(`${APP_HOST}${path}`, {
    ...init,
    headers: { 'cf-visitor': '{"scheme":"http"}', ...(init.headers ?? {}) },
  });
}

describe('security headers + HTTPS redirect (WIC-1011)', () => {
  beforeEach(() => {
    _resetConfig();
    delete process.env.SUPABASE_JWT_SECRET;
  });

  afterEach(() => {
    vi.clearAllMocks();
    _resetConfig();
  });

  describe('Finding A2 — security headers on Worker responses', () => {
    it('sets every hardening header on a normal response', async () => {
      const res = await buildApp().request(`${APP_HOST}/health`);

      for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
        expect(res.headers.get(name), name).toBe(value);
      }
    });

    it('sets them on 404s and error responses too', async () => {
      const res = await buildApp().request(`${APP_HOST}/api/definitely-not-a-route`);

      expect(res.status).toBe(404);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('strict-transport-security')).toBe(
        EXPECTED_HEADERS['strict-transport-security']
      );
    });

    it('does not clobber a header a handler already set', async () => {
      const app = buildApp();
      app.get('/custom', (c) => {
        c.header('X-Frame-Options', 'SAMEORIGIN');
        return c.text('ok');
      });

      const res = await app.request(`${APP_HOST}/custom`);
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    });

    it('survives a response with immutable headers (the ASSETS binding case)', async () => {
      const app = buildApp();
      // `Response` objects produced by fetch() — including ASSETS.fetch() — have a
      // guarded header list that throws on set(). The middleware must rebuild, not drop.
      app.get('/immutable', () => {
        const res = new Response('shell', { headers: { 'Content-Type': 'text/html' } });
        Object.defineProperty(res.headers, 'set', {
          value: () => {
            throw new TypeError('immutable');
          },
        });
        return res;
      });

      const res = await app.request(`${APP_HOST}/immutable`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('shell');
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('strict-transport-security')).toBe(
        EXPECTED_HEADERS['strict-transport-security']
      );
    });
  });

  describe('Finding A — cleartext requests are redirected', () => {
    it('301s a cleartext GET to the same URL over HTTPS', async () => {
      const res = await buildApp().fetch(cleartext('/dashboard?tab=saved'));

      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('https://app.careerpin.app/dashboard?tab=saved');
    });

    it('301s cleartext API reads before any handler runs', async () => {
      const res = await buildApp().fetch(cleartext('/api/applications'));

      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('https://app.careerpin.app/api/applications');
    });

    it('308s cleartext writes so the method and body survive the retry', async () => {
      const res = await buildApp().fetch(
        cleartext('/api/applications', { method: 'POST', body: '{}' })
      );

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('https://app.careerpin.app/api/applications');
    });

    it('honours x-forwarded-proto for non-Cloudflare deployments', async () => {
      const res = await buildApp().fetch(
        new Request(`${APP_HOST}/health`, { headers: { 'x-forwarded-proto': 'http, https' } })
      );

      expect(res.status).toBe(301);
    });

    it('leaves HTTPS requests alone', async () => {
      const res = await buildApp().fetch(
        new Request(`${APP_HOST}/health`, { headers: { 'cf-visitor': '{"scheme":"https"}' } })
      );

      expect(res.status).not.toBe(301);
    });

    it('never redirects loopback dev, which is plain HTTP by design', async () => {
      const res = await buildApp().request('http://localhost:3000/health');

      expect(res.status).not.toBe(301);
      expect(res.status).not.toBe(308);
    });

    // The redirect is the *first* thing a downgraded client touches, so it has to carry
    // HSTS itself — otherwise the pin only lands on the follow-up request and the first
    // contact of every session stays downgradeable. This holds only because
    // securityHeaders() is registered ahead of httpsRedirect() in buildApp(); swapping
    // those two lines silently reopens the hole, so assert it here.
    it('carries the hardening headers on the redirect itself', async () => {
      const res = await buildApp().fetch(cleartext('/dashboard'));

      expect(res.status).toBe(301);
      for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
        expect(res.headers.get(name), name).toBe(value);
      }
    });

    it('never emits a cleartext Location, even for a request carrying a port', async () => {
      const res = await buildApp().fetch(
        new Request('http://app.careerpin.app:80/health', {
          headers: { 'cf-visitor': '{"scheme":"http"}' },
        })
      );

      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('https://app.careerpin.app/health');
    });
  });

  describe('Finding B — static asset headers ship with the build', () => {
    const headersFile = readFileSync(
      fileURLToPath(new URL('../../web/public/_headers', import.meta.url)),
      'utf8'
    );

    it('marks fingerprinted assets immutable', () => {
      expect(headersFile).toMatch(/^\/assets\/\*$/m);
      expect(headersFile).toMatch(/Cache-Control: public, max-age=31536000, immutable/);
    });

    it('keeps index.html revalidating', () => {
      expect(headersFile).toMatch(/^\/index\.html$/m);
      expect(headersFile).toMatch(/Cache-Control: public, max-age=0, must-revalidate/);
    });

    it('declares the same hardening headers the Worker sends', () => {
      for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
        expect(headersFile.toLowerCase()).toContain(`${name}: ${value.toLowerCase()}`);
      }
    });
  });
});
