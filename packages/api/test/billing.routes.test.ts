/**
 * WIC-2643 (WIC-2650 QA note) — committed coverage for the *route-level* ACs,
 * which the service-layer suites do not reach:
 *   - billing endpoints require a valid Supabase JWT (401 without),
 *   - the Stripe webhook is NOT behind the JWT middleware (a bad/missing
 *     signature reaches signature verification and 400s, it never 401s),
 *   - billing degrades to 503 when Stripe is not configured.
 *
 * These exercise the real Hono app (`buildApp()`) through `app.request(...)`, so
 * guard ordering and route mounting are what is under test. `getDb` is stubbed to
 * **throw**: every path asserted here must short-circuit before any DB access, so
 * a regression that reaches the database fails loudly rather than silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { _resetConfig } from '../src/config.js';
import { _resetJwksCache } from '../src/middleware/auth.js';

// Any DB access on the paths under test is a bug — make it loud.
vi.mock('../src/db/client.js', () => ({
  getDb: () => {
    throw new Error('getDb must not be called on a guard/signature short-circuit path');
  },
}));

// The webhook happy path must not touch the DB in this suite, so mock the writer.
vi.mock('../src/services/subscription.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/subscription.service.js')>()),
  handleStripeEvent: vi.fn().mockResolvedValue(true),
}));

const JWT_SECRET = 'super-secret-jwt-key-for-testing-only-32-chars!!';
const WEBHOOK_SECRET = 'whsec_test_secret';

async function signToken(sub: string): Promise<string> {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function stripeSigHeader(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

describe('billing + webhook route wiring (WIC-2643)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Auth enforced: setting the JWT secret (SUPABASE_URL left unset) takes the
    // JWT path rather than the local-dev bypass.
    process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
    delete process.env.SUPABASE_URL;
    _resetConfig();
    _resetJwksCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfig();
    _resetJwksCache();
  });

  describe('billing endpoints require a valid Supabase JWT', () => {
    it('POST /api/billing/checkout-session with no Authorization → 401', async () => {
      const app = buildApp();
      const res = await app.request('/api/billing/checkout-session', { method: 'POST' });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/billing/portal-session with no Authorization → 401', async () => {
      const app = buildApp();
      const res = await app.request('/api/billing/portal-session', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('POST /api/billing/checkout-session with an invalid token → 401', async () => {
      const app = buildApp();
      const res = await app.request('/api/billing/checkout-session', {
        method: 'POST',
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('billing degrades to 503 when Stripe is not configured', () => {
    it('authenticated checkout with STRIPE_SECRET_KEY unset → 503 (before any DB access)', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PRICE_PRO;
      _resetConfig();
      const app = buildApp();
      const res = await app.request('/api/billing/checkout-session', {
        method: 'POST',
        headers: { authorization: `Bearer ${await signToken('user-1')}` },
      });
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('BILLING_NOT_CONFIGURED');
    });

    it('authenticated portal with STRIPE_SECRET_KEY unset → 503', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      _resetConfig();
      const app = buildApp();
      const res = await app.request('/api/billing/portal-session', {
        method: 'POST',
        headers: { authorization: `Bearer ${await signToken('user-1')}` },
      });
      expect(res.status).toBe(503);
    });
  });

  describe('the Stripe webhook is NOT behind the JWT middleware', () => {
    it('a missing signature returns 400 (signature error), never 401, even with auth configured', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      _resetConfig();
      const app = buildApp();
      // No Authorization header at all. If the webhook were behind authMiddleware
      // this would 401; instead it reaches signature verification and 400s.
      const res = await app.request('/api/stripe/webhook', {
        method: 'POST',
        body: JSON.stringify({ id: 'evt', type: 'invoice.paid', data: { object: {} } }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('STRIPE_SIGNATURE_INVALID');
    });

    it('a bad signature returns 400', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      _resetConfig();
      const app = buildApp();
      const res = await app.request('/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1700000000,v1=deadbeef' },
        body: JSON.stringify({ id: 'evt', type: 'invoice.paid', data: { object: {} } }),
      });
      expect(res.status).toBe(400);
    });

    it('a correctly-signed payload returns 200 and is handled', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      _resetConfig();
      const app = buildApp();
      const body = JSON.stringify({
        id: 'evt_1',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', status: 'active', metadata: { userId: 'user-1' } } },
      });
      const res = await app.request('/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': stripeSigHeader(WEBHOOK_SECRET, body) },
        body,
      });
      expect(res.status).toBe(200);
      expect((await res.json()).received).toBe(true);
    });

    it('returns 503 when STRIPE_WEBHOOK_SECRET is unset', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      _resetConfig();
      const app = buildApp();
      const res = await app.request('/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: '{}',
      });
      expect(res.status).toBe(503);
    });
  });
});
