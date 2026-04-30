import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
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

const TEST_JWT_SECRET = 'super-secret-jwt-key-for-testing-only-32-chars!!';

async function signToken(secret: string, sub: string, expiresIn = '1h') {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

describe('Auth Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    _resetConfig();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfig();
  });

  describe('when SUPABASE_JWT_SECRET is not set', () => {
    it('allows requests without Authorization header', async () => {
      delete process.env.SUPABASE_JWT_SECRET;
      const app = buildApp({ logger: false });
      const res = await app.inject({ method: 'GET', url: '/api/applications' });
      expect(res.statusCode).toBe(200);
    });

    it('allows requests with any Authorization header', async () => {
      delete process.env.SUPABASE_JWT_SECRET;
      const app = buildApp({ logger: false });
      const res = await app.inject({
        method: 'GET',
        url: '/api/applications',
        headers: { authorization: 'Bearer garbage-token' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('when SUPABASE_JWT_SECRET is set', () => {
    it('returns 401 when Authorization header is missing', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp({ logger: false });
      const res = await app.inject({ method: 'GET', url: '/api/applications' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header is not a Bearer token', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp({ logger: false });
      const res = await app.inject({
        method: 'GET',
        url: '/api/applications',
        headers: { authorization: 'Basic somebase64' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for an invalid JWT', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp({ logger: false });
      const res = await app.inject({
        method: 'GET',
        url: '/api/applications',
        headers: { authorization: 'Bearer not.a.valid.jwt' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for a JWT signed with the wrong secret', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp({ logger: false });
      const wrongToken = await signToken('wrong-secret-key-32-chars-minimum!!', 'user-123');
      const res = await app.inject({
        method: 'GET',
        url: '/api/applications',
        headers: { authorization: `Bearer ${wrongToken}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for an expired JWT', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp({ logger: false });
      const expiredToken = await signToken(TEST_JWT_SECRET, 'user-123', '-1s');
      const res = await app.inject({
        method: 'GET',
        url: '/api/applications',
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('allows request with a valid JWT and sets userId on request', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp({ logger: false });
      const token = await signToken(TEST_JWT_SECRET, 'user-abc-123');
      const res = await app.inject({
        method: 'GET',
        url: '/api/applications',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('does not protect the /health endpoint', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp({ logger: false });
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });
});
