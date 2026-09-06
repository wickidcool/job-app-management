import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, createRemoteJWKSet } from 'jose';
import { buildApp } from '../src/app.js';
import { _resetConfig, getConfig } from '../src/config.js';
import { _resetJwksCache } from '../src/middleware/auth.js';
// Mocked below; imported so the WIC-1554 cases can grade *whether a handler
// ran*, not just the status code the middleware returned.
import { listApplications } from '../src/services/application.service.js';
import { DEV_OWNER } from './helpers/local-dev-owner.js';

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return { ...actual, createRemoteJWKSet: vi.fn(actual.createRemoteJWKSet) };
});

// Mock all services so no DB is needed
vi.mock('../src/services/application.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/application.service.js')>()),
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn().mockResolvedValue({ applications: [], totalCount: 0 }),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));
vi.mock('../src/services/dashboard.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/dashboard.service.js')>()),
  getDashboardStats: vi.fn(),
}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
vi.mock('../src/services/cover-letter.service.js', () => ({}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
vi.mock('../src/services/resume.service.js', () => ({}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
vi.mock('../src/services/project.service.js', () => ({}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
vi.mock('../src/services/dialogue.service.js', () => ({}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
vi.mock('../src/services/catalog.service.js', () => ({}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
vi.mock('../src/services/reports.service.js', () => ({}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
vi.mock('../src/services/resume-variant.service.js', () => ({}));
// deliberate-total-mock: auth middleware only; routes are registered, never invoked, so the real module would add DB imports for no assertion
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
    _resetJwksCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfig();
    _resetJwksCache();
  });

  describe('when SUPABASE_JWT_SECRET is not set', () => {
    it('allows requests without Authorization header', async () => {
      delete process.env.SUPABASE_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', { method: 'GET' });
      expect(res.status).toBe(200);
    });

    it('allows requests with any Authorization header', async () => {
      delete process.env.SUPABASE_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: 'Bearer garbage-token' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('when SUPABASE_JWT_SECRET is set', () => {
    it('returns 401 when Authorization header is missing', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', { method: 'GET' });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header is not a Bearer token', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: 'Basic somebase64' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for an invalid JWT', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: 'Bearer not.a.valid.jwt' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for a JWT signed with the wrong secret', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const wrongToken = await signToken('wrong-secret-key-32-chars-minimum!!', 'user-123');
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${wrongToken}` },
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired JWT', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const expiredToken = await signToken(TEST_JWT_SECRET, 'user-123', '-1s');
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      expect(res.status).toBe(401);
    });

    it('allows request with a valid JWT and sets userId on request', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const token = await signToken(TEST_JWT_SECRET, 'user-abc-123');
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('does not protect the /health endpoint', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/health', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ok' });
    });

    // WIC-1296 regression guard: /api/health must be a REAL liveness check, not the
    // auth middleware's blanket 401. Before the fix, an uptime probe pointed at
    // /api/health always saw 401 and could never register a database outage. It must
    // now answer 200 with a DB status even with no Authorization header while auth is on.
    it('does not protect the /api/health endpoint', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/health', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ok' });
    });
  });

  describe('ES256 / JWKS path', () => {
    it('authenticates a valid ES256 token via JWKS', async () => {
      const { privateKey, publicKey } = await generateKeyPair('ES256');
      const pubJwk = await exportJWK(publicKey);
      const issuer = 'https://test.supabase.co/auth/v1';

      vi.mocked(createRemoteJWKSet).mockReturnValueOnce(
        createLocalJWKSet({ keys: [{ ...pubJwk, alg: 'ES256', use: 'sig' }] })
      );

      const token = await new SignJWT({ sub: 'user-es256' })
        .setProtectedHeader({ alg: 'ES256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .setIssuer(issuer)
        .setAudience('authenticated')
        .sign(privateKey);

      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('rejects an ES256 token missing the iss claim', async () => {
      const { privateKey } = await generateKeyPair('ES256');

      const token = await new SignJWT({ sub: 'user-es256' })
        .setProtectedHeader({ alg: 'ES256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .setAudience('authenticated')
        .sign(privateKey);

      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    });
  });

  /**
   * WIC-1554 — a token that verifies but carries no identity is not authenticated.
   *
   * The middleware read `(payload.sub as string) ?? null` and called `next()`,
   * so a validly signed, unexpired, `sub`-less token was admitted with
   * `userId: null`. Every route launders that to `undefined`
   * (`c.get('userId') ?? undefined`), and the services read `undefined` as
   * "no owner filter" — which is how an owner-less caller reached, and deleted,
   * another user's project (`project.sibling-owner-required.test.ts`).
   *
   * Graded on two things, because status alone is weak here: a `sub`-less token
   * is *also* rejected by a middleware that simply failed to parse it. The
   * service-never-called assertion is what pins "no request was served without
   * an identity", and the arg assertion on the control is what pins that a real
   * `sub` still arrives intact rather than being dropped by an over-broad guard.
   */
  describe('WIC-1554 — a verified token with no sub is rejected', () => {
    /** Same signature and expiry as `signToken`, with the `sub` claim omitted. */
    async function signSubless(secret: string, claims: Record<string, unknown> = {}) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(secret));
    }

    it('HS256: a sub-less token is 401 and reaches no service', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const token = await signSubless(TEST_JWT_SECRET, { email: 'a@example.com' });

      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
      // Pre-fix this was 200. The status is the visible half; this is the half
      // that matters — no handler ran on behalf of a caller with no identity.
      expect(vi.mocked(listApplications)).not.toHaveBeenCalled();
    });

    it('HS256: an empty-string sub is 401 — `?? null` would have admitted it', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      // `'' ?? null` is `''`, which is falsy, so it degrades identically to
      // `null` at every downstream call site while passing a nullish check.
      const token = await signSubless(TEST_JWT_SECRET, { sub: '' });

      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(401);
      expect(vi.mocked(listApplications)).not.toHaveBeenCalled();
    });

    it('HS256: a non-string sub is 401 rather than a cast to one', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      // The old code was a bare `as string` cast, which is a compile-time
      // assertion and no runtime check at all.
      const token = await signSubless(TEST_JWT_SECRET, { sub: 12345 });

      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(401);
      expect(vi.mocked(listApplications)).not.toHaveBeenCalled();
    });

    it('ES256/JWKS: a sub-less token is 401 on the asymmetric path too', async () => {
      const { privateKey, publicKey } = await generateKeyPair('ES256');
      const pubJwk = await exportJWK(publicKey);
      const issuer = 'https://test.supabase.co/auth/v1';

      vi.mocked(createRemoteJWKSet).mockReturnValueOnce(
        createLocalJWKSet({ keys: [{ ...pubJwk, alg: 'ES256', use: 'sig' }] })
      );

      // Both branches assigned `userId` the same way, so both needed the fix;
      // a matrix that only covered HS256 would have left the Supabase ES256
      // path — the one production actually uses — open.
      const token = await new SignJWT({ email: 'a@example.com' })
        .setProtectedHeader({ alg: 'ES256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .setIssuer(issuer)
        .setAudience('authenticated')
        .sign(privateKey);

      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(401);
      expect(vi.mocked(listApplications)).not.toHaveBeenCalled();
    });

    it('control: a real sub still authenticates and still arrives at the service', async () => {
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const token = await signToken(TEST_JWT_SECRET, 'user-abc-123');

      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      // Without this the four cases above are satisfied by a middleware that
      // rejects everything, and the guard would read as correct while having
      // broken auth outright.
      expect(vi.mocked(listApplications)).toHaveBeenCalledWith(expect.anything(), 'user-abc-123');
    });

    it('control: the local auth-bypass dev mode is untouched', async () => {
      // ADR-003: the bypass is the `!supabaseUrl && !jwtSecret` branch, which
      // returns before any token is looked at. WIC-1554 deliberately did not
      // touch it, and this pins that the two paths stayed separate — the fix
      // removes anonymous *authenticated* callers, not the configured bypass.
      //
      // ADR-010 D3 (WIC-1964) later changed what the bypass *supplies* — a real
      // `LOCAL_DEV_USER_ID` rather than an absence — without changing when it
      // fires, which is why the owner below is `DEV_OWNER` and not `undefined`.
      // The separation this test exists to pin is unaffected: a sub-less token
      // still never reaches a route in a configured deployment, and here it is
      // still never looked at.
      delete process.env.SUPABASE_JWT_SECRET;
      delete process.env.SUPABASE_URL;
      const app = buildApp();
      const token = await signSubless('irrelevant-secret-key-32-chars-min!!');

      const res = await app.request('/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(listApplications)).toHaveBeenCalledWith(expect.anything(), DEV_OWNER);
    });
  });

  /**
   * WIC-2191 — a *blank* binding must fall through to config, not resolve to `''`.
   *
   * The middleware resolved both gate inputs with `??`, which falls back only on
   * `null`/`undefined`. A Worker binding that is present-but-empty therefore won
   * the coalesce as `''`, which is falsy, so `!supabaseUrl && !jwtSecret` was
   * TRUE and the **local-dev bypass fired in a deployed Worker** — returning
   * `next()` above the `Authorization` check, so no token was needed at all.
   *
   * The direction is what makes it worth a suite of its own. WIC-2183 was the
   * same coercion class and failed *loud* (a 503). This one fails **open**: no
   * error, no log line, a 200, and `userId` set to `LOCAL_DEV_USER_ID_DEFAULT` —
   * the sentinel `migrations/0017_enforce_userid_not_null.sql` backfills every
   * pre-tenancy row to. An unauthenticated caller would read and write as the
   * tenant that owns the legacy data.
   *
   * These cases exercise the **binding** path (`app.request`'s third argument),
   * which nothing in this file did before — every pre-existing case reaches the
   * middleware through `process.env`/`getConfig()` with `c.env` undefined, so the
   * `??` was never given a blank left-hand side to coalesce.
   */
  describe('WIC-2191 — a blank Worker binding does not open the local-dev bypass', () => {
    const REAL_URL = 'https://project.supabase.co';

    it('blank both bindings WITH config set: config wins, so a token is required', async () => {
      process.env.SUPABASE_URL = REAL_URL;
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();

      const res = await app.request(
        '/api/applications',
        { method: 'GET' },
        { SUPABASE_URL: '', SUPABASE_JWT_SECRET: '' }
      );

      // Pre-fix this was 200: `'' ?? config` is `''`, both gate inputs read
      // falsy, and the bypass returned before the header was ever inspected.
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
      // The half that matters — no route was served for an unauthenticated caller.
      expect(vi.mocked(listApplications)).not.toHaveBeenCalled();
    });

    it('blank both bindings WITH config set: the configured secret still authenticates', async () => {
      process.env.SUPABASE_URL = REAL_URL;
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const token = await signToken(TEST_JWT_SECRET, 'user-blank-binding');

      const res = await app.request(
        '/api/applications',
        { method: 'GET', headers: { authorization: `Bearer ${token}` } },
        { SUPABASE_URL: '', SUPABASE_JWT_SECRET: '' }
      );

      // Positive control. Without it the case above is satisfied by a middleware
      // that 401s everything — i.e. by breaking auth rather than fixing it. This
      // also pins that the fallback yields the *usable* configured secret, not
      // merely a truthy value that fails verification.
      expect(res.status).toBe(200);
      expect(vi.mocked(listApplications)).toHaveBeenCalledWith(
        expect.anything(),
        'user-blank-binding'
      );
    });

    it('blank both bindings and NO config: the bypass still fires — unconfigured is unconfigured', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_JWT_SECRET;
      const app = buildApp();

      const res = await app.request(
        '/api/applications',
        { method: 'GET' },
        { SUPABASE_URL: '', SUPABASE_JWT_SECRET: '' }
      );

      // ADR-010 D3 / the middleware comment at :69-72: the fix collapses "blank"
      // into "absent in the binding" so the *config* fallback gets its turn. It
      // must not tighten *when* the bypass fires. With nothing configured on
      // either side there is genuinely no auth to enforce.
      expect(res.status).toBe(200);
      expect(vi.mocked(listApplications)).toHaveBeenCalledWith(expect.anything(), DEV_OWNER);
    });

    it('absent both bindings and no config: the bypass supplies the sentinel owner (no regression)', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_JWT_SECRET;
      const app = buildApp();

      const res = await app.request('/api/applications', { method: 'GET' }, {});

      expect(res.status).toBe(200);
      expect(vi.mocked(listApplications)).toHaveBeenCalledWith(expect.anything(), DEV_OWNER);
    });

    it('blank SUPABASE_JWT_SECRET only: verification uses the configured secret, not an empty key', async () => {
      // `SUPABASE_URL` absent on *both* sides, so the bypass gate turns entirely
      // on the secret. Pre-fix: `'' ?? TEST_JWT_SECRET` is `''` → both inputs
      // falsy → bypass → 200 for a token signed with anything at all.
      delete process.env.SUPABASE_URL;
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      const app = buildApp();
      const wrongToken = await signToken('some-other-secret-32-chars-minimum!!', 'attacker');

      const res = await app.request(
        '/api/applications',
        { method: 'GET', headers: { authorization: `Bearer ${wrongToken}` } },
        { SUPABASE_JWT_SECRET: '' }
      );

      expect(res.status).toBe(401);
      expect(vi.mocked(listApplications)).not.toHaveBeenCalled();
    });

    /**
     * The fix is `||`, deliberately NOT `?.trim() ||`.
     *
     * The card proposed mirroring line 77's `?.trim() ||` idiom. That is right
     * for `LOCAL_DEV_USER_ID`, where the fallback is a safe sentinel, and wrong
     * here, where the fallback decides whether auth runs at all: `'   '` is
     * truthy, so today a whitespace-only binding takes the JWT path and 401s
     * everything — fail-CLOSED. Adding `.trim()` would collapse it to `''`, fall
     * through to an absent config, and open the very bypass this card closes.
     *
     * That is not hypothetical cover: `deploy.yml`'s guard is `[ -z "$X" ]`,
     * which passes a whitespace-only secret. Trimming would move the one input
     * CI cannot catch from the safe direction to the unsafe one.
     */
    it('whitespace-only binding stays fail-CLOSED — the fix must not trim', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_JWT_SECRET;
      const app = buildApp();

      const res = await app.request(
        '/api/applications',
        { method: 'GET' },
        { SUPABASE_URL: '   ', SUPABASE_JWT_SECRET: '   ' }
      );

      expect(res.status).toBe(401);
      expect(vi.mocked(listApplications)).not.toHaveBeenCalled();
    });
  });

  /**
   * WIC-2191, config layer — `config.ts` built these with a bare `??` too, so a
   * blank `process.env` value became `''` and the declared `string | null` type
   * was not honest about it.
   *
   * The card asked for this "so `plugins/auth.ts` is covered". That premise does
   * not hold and the test does not pretend otherwise: `src/plugins/auth.ts` is
   * dead code — nothing imports `authPlugin`, `src/plugins` is in `tsconfig.json`'s
   * `exclude`, and `fastify`/`fastify-plugin` are not dependencies, so the module
   * cannot even be imported here to assert against. What is graded instead is the
   * layer that is real and shared: `getConfig()`, which is the fallback side of
   * every `c.env?.X ?? getConfig().x` call site in the live Hono middleware.
   */
  describe('WIC-2191 — getConfig() normalises a blank env var to null', () => {
    it('blank SUPABASE_URL / SUPABASE_JWT_SECRET resolve to null, not the empty string', async () => {
      process.env.SUPABASE_URL = '';
      process.env.SUPABASE_JWT_SECRET = '';
      _resetConfig();

      const config = getConfig();
      expect(config.supabaseUrl).toBeNull();
      expect(config.supabaseJwtSecret).toBeNull();
    });

    it('a configured value is passed through byte-for-byte', async () => {
      process.env.SUPABASE_URL = 'https://project.supabase.co';
      process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
      _resetConfig();

      // Control: the normalisation must not trim, rewrite or otherwise touch a
      // real value — `supabaseJwtSecret` is HS256 key material.
      const config = getConfig();
      expect(config.supabaseUrl).toBe('https://project.supabase.co');
      expect(config.supabaseJwtSecret).toBe(TEST_JWT_SECRET);
    });
  });
});
