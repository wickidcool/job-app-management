import { describe, it, expect, vi } from 'vitest';
import { createMiddleware } from 'hono/factory';

// Stand in for a signed-in caller. Routes that check `userId` before reading the
// body (onboarding) would otherwise 401 before reaching the guard under test —
// which is correct behaviour, just not the behaviour being measured here.
vi.mock('../src/middleware/auth.js', () => ({
  authMiddleware: createMiddleware(async (c, next) => {
    c.set('userId', '00000000-0000-4000-8000-000000000001');
    await next();
  }),
  _resetJwksCache: vi.fn(),
}));

import { buildApp } from '../src/app.js';

/**
 * Malformed JSON on a write endpoint must be a 400, not a 500 (WIC-1524).
 *
 * Every case here is paired with a WRONG-SHAPE CONTROL: valid JSON that fails
 * the route's Zod schema. Zod's 400 path was already healthy before the fix, so
 * a test asserting only "400" cannot tell `readJsonBody`'s guard from Zod's and
 * would keep passing if the helper were deleted. The discriminator is the
 * message — only the JSON guard says "Request body is not valid JSON".
 */

const JSON_GUARD = 'Request body is not valid JSON';

/**
 * One representative write endpoint per route file carrying a `readJsonBody` call.
 *
 * `auth.ts` is the deliberate omission — its two sites sit behind a config gate that
 * returns `503 NOT_CONFIGURED` before the body is read whenever Supabase is unconfigured,
 * which is every environment this suite runs in. Measured for both `/auth/login` and
 * `/auth/register`, not assumed from one.
 */
const ENDPOINTS: [file: string, method: string, path: string][] = [
  ['applications.ts', 'POST', '/api/applications'],
  ['catalog.routes.ts', 'POST', '/api/catalog/generate-diff'],
  ['cover-letters.ts', 'POST', '/api/cover-letters/generate'],
  ['dialogue.routes.ts', 'POST', '/api/projects/proj-1/capture'],
  ['interview-preps.ts', 'POST', '/api/interview-preps'],
  ['onboarding.ts', 'POST', '/api/users/me/onboarding/progress'],
  ['personal-info.ts', 'PATCH', '/api/personal-info'],
  ['projects.ts', 'POST', '/api/projects'],
  ['resume-variants.ts', 'POST', '/api/resume-variants/generate'],
];

const req = (method: string, path: string, body: string) =>
  buildApp().request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });

describe('malformed JSON body (WIC-1524)', () => {
  describe.each(ENDPOINTS)('%s — %s %s', (_file, method, path) => {
    it('returns 400 VALIDATION_ERROR for truncated JSON', async () => {
      const res = await req(method, path, '{"firstName": "Jane",');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe(JSON_GUARD);
    });

    it('returns 400 VALIDATION_ERROR for an empty body', async () => {
      const res = await req(method, path, '');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toBe(JSON_GUARD);
    });

    it('CONTROL: valid JSON of the wrong shape is rejected by Zod, not the JSON guard', async () => {
      const res = await req(method, path, '[]');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).not.toBe(JSON_GUARD);
    });
  });

  it('parses a body with no Content-Type header, and still guards it', async () => {
    // Hono does not gate `c.req.json()` on Content-Type, so a missing header is
    // not a separate code path — valid JSON parses, malformed JSON hits the guard.
    const ok = await buildApp().request('/api/personal-info', {
      method: 'PATCH',
      body: '{"email":"not-an-email"}',
    });
    expect(ok.status).toBe(400);
    expect((await ok.json()).error.message).not.toBe(JSON_GUARD);

    const bad = await buildApp().request('/api/personal-info', {
      method: 'PATCH',
      body: '{"email":',
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toBe(JSON_GUARD);
  });
});
