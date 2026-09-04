import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import { _resetConfig } from '../src/config.js';
import { _resetJwksCache } from '../src/middleware/auth.js';

/**
 * The injected absence. `vi.hoisted` because the `vi.mock` factory below is
 * lifted above every `const`, so a plain module-level binding would be in its
 * temporal dead zone when the factory runs.
 *
 * Flipping this to `true` makes the auth middleware resolve `userId: null` and
 * call `next()` — precisely the state the app can no longer reach on its own
 * after ADR-010 D3. Everything downstream is the real thing: the real routes,
 * the real `requireOwner`, and only the service layer mocked. Left `false`, the
 * genuine middleware runs, so the "caller with a sub" block below still
 * exercises real JWT verification.
 */
const inject = vi.hoisted(() => ({ ownerless: false }));

vi.mock('../src/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/middleware/auth.js')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...actual,
    authMiddleware: createMiddleware(async (c, next) => {
      if (!inject.ownerless) return actual.authMiddleware(c, next);
      c.set('userId', null);
      await next();
    }),
  };
});

/**
 * WIC-1638 / ADR-010 AC-4 — the owner-absent request reads and writes nothing.
 *
 * The services these routes call now take `userId: string`, so the owner-absent
 * branch is gone from every predicate. That alone is not the guarantee, because
 * a route can still *manufacture* an absence: the shape being retired here is
 * literally `c.get('userId') ?? undefined`, which laundered a null owner into an
 * optional argument and pushed the decision down into the predicate.
 *
 * `requireOwner` is the single place that absence is turned into an error.
 * `requireOwner.ts` used to name two callers that reach it with no owner: a
 * token that verifies but carries no `sub`, and the local dev bypass (neither
 * `SUPABASE_URL` nor `SUPABASE_JWT_SECRET` configured). Both are now closed
 * upstream. WIC-1554 closed the first at `middleware/auth.ts` itself — such a
 * token is rejected `401 UNAUTHORIZED` before any route runs. ADR-010 D3
 * (WIC-1964) closed the second: the bypass supplies a real `LOCAL_DEV_USER_ID`
 * rather than `null`, so local dev is a tenant and not an absence.
 *
 * **So no path through the real app reaches this guard with no owner any more,
 * and that is the point of D1 rather than a reason to delete these tests.**
 * `requireOwner` is now defence in depth, and what has to stay true is the
 * conditional: *if* an absence ever reaches a route again — a new caller, a
 * regressed middleware, a future bypass — the request must still stop at the
 * edge. These tests therefore inject the absence at the middleware boundary
 * (see `ownerless` below) instead of manufacturing it through the bypass, which
 * is what they did while the bypass still produced one. Driving it through the
 * real routes and the real `requireOwner`, with only the service layer mocked,
 * is what keeps assertion (2) meaningful.
 *
 * Two things are asserted per entry point:
 *
 *   1. the response is 401 `OWNER_REQUIRED`, and
 *   2. **the service was never called at all**.
 *
 * (2) is the assertion that matters and the reason this file mocks the service
 * layer rather than the database. AC-4 warns that a not-found guard and an
 * ownership guard return the same status, so a response-code assertion cannot
 * tell them apart. `not.toHaveBeenCalled()` can: it proves the request was
 * stopped at the edge, before any read or write was issued, rather than reaching
 * a query that merely happened to match no rows.
 */

vi.mock('../src/services/catalog.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/catalog.service.js')>()),
  listDiffs: vi.fn(),
  getDiff: vi.fn(),
  generateDiff: vi.fn(),
  applyDiff: vi.fn(),
  discardDiff: vi.fn(),
  resolveDiffItem: vi.fn(),
  listCompanies: vi.fn(),
  mergeCompanies: vi.fn(),
  listJobFitTags: vi.fn(),
  listTechStackTags: vi.fn(),
  updateJobFitTag: vi.fn(),
  updateTechStackTag: vi.fn(),
  mergeJobFitTags: vi.fn(),
  mergeTechStackTags: vi.fn(),
  listBullets: vi.fn(),
  listThemes: vi.fn(),
}));

vi.mock('../src/services/resume-variant.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/resume-variant.service.js')>()),
  generateResumeVariant: vi.fn(),
  listResumeVariants: vi.fn(),
  getResumeVariant: vi.fn(),
  updateResumeVariant: vi.fn(),
  deleteResumeVariant: vi.fn(),
  reviseResumeVariant: vi.fn(),
  suggestBullets: vi.fn(),
  exportResumeVariant: vi.fn(),
}));

vi.mock('../src/services/interviewPrep.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/interviewPrep.service.js')>()),
  generateInterviewPrep: vi.fn(),
  listInterviewPreps: vi.fn(),
  getInterviewPrep: vi.fn(),
  updateInterviewPrep: vi.fn(),
  addStory: vi.fn(),
  updateStory: vi.fn(),
  logPracticeSession: vi.fn(),
  deleteInterviewPrep: vi.fn(),
}));

vi.mock('../src/services/job-fit.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/job-fit.service.js')>()),
  analyzeJobFit: vi.fn(),
}));

import * as catalogService from '../src/services/catalog.service.js';
import * as resumeVariantService from '../src/services/resume-variant.service.js';
import * as interviewPrepService from '../src/services/interviewPrep.service.js';

const JWT_SECRET = 'super-secret-jwt-key-for-testing-only-32-chars!!';

/** Long enough for the `min(50)` on every job-description field. */
const JD_TEXT = 'Senior backend engineer with deep Postgres and TypeScript experience';

/**
 * Every entry point WIC-1638 converted from an optional owner to a required one.
 *
 * `service` is the exact mock the route would call on the happy path, so the
 * "nothing was read or written" assertion is specific rather than a blanket
 * "no service ran". `body` is deliberately valid: Zod validation runs before
 * `requireOwner` on these routes, and a 400 would mask the 401 we are pinning.
 */
const GUARDED = [
  {
    name: 'generateDiff',
    path: '/api/catalog/generate-diff',
    method: 'POST',
    body: { sourceType: 'resume', sourceId: '01HZ_RESUME_001' },
    service: () => catalogService.generateDiff,
  },
  {
    name: 'mergeCompanies',
    path: '/api/catalog/companies/merge',
    method: 'POST',
    body: { sourceCompanyIds: ['01HZ_CO_002'], targetCompanyId: '01HZ_CO_001' },
    service: () => catalogService.mergeCompanies,
  },
  {
    name: 'mergeJobFitTags',
    path: '/api/catalog/tags/job-fit/merge',
    method: 'POST',
    body: { sourceTagIds: ['01HZ_TAG_002'], targetTagId: '01HZ_TAG_001' },
    service: () => catalogService.mergeJobFitTags,
  },
  {
    name: 'mergeTechStackTags',
    path: '/api/catalog/tags/tech-stack/merge',
    method: 'POST',
    body: { sourceTagIds: ['01HZ_TAG_002'], targetTagId: '01HZ_TAG_001' },
    service: () => catalogService.mergeTechStackTags,
  },
  {
    name: 'updateJobFitTag',
    path: '/api/catalog/tags/job-fit/01HZ_TAG_001',
    method: 'PATCH',
    body: { displayName: 'Renamed', version: 1 },
    service: () => catalogService.updateJobFitTag,
  },
  {
    name: 'updateTechStackTag',
    path: '/api/catalog/tags/tech-stack/01HZ_TAG_001',
    method: 'PATCH',
    body: { displayName: 'Renamed', version: 1 },
    service: () => catalogService.updateTechStackTag,
  },
  {
    name: 'generateResumeVariant',
    path: '/api/resume-variants/generate',
    method: 'POST',
    // `generateSchema` is `.strict()` and requires >= 50 chars of JD text.
    body: { jobDescriptionText: JD_TEXT },
    service: () => resumeVariantService.generateResumeVariant,
  },
  {
    name: 'suggestBullets',
    path: '/api/resume-variants/suggest-bullets',
    method: 'POST',
    body: { jobDescriptionText: JD_TEXT },
    service: () => resumeVariantService.suggestBullets,
  },
  {
    name: 'getResumeVariant',
    path: '/api/resume-variants/01HZ_VAR_001',
    method: 'GET',
    body: undefined,
    service: () => resumeVariantService.getResumeVariant,
  },
  {
    name: 'reviseResumeVariant',
    path: '/api/resume-variants/01HZ_VAR_001/revise',
    method: 'POST',
    body: { instructions: 'Tighten the professional summary', version: 1 },
    service: () => resumeVariantService.reviseResumeVariant,
  },
  {
    name: 'generateInterviewPrep',
    path: '/api/interview-preps',
    method: 'POST',
    body: { applicationId: '01HZ_APP_001' },
    service: () => interviewPrepService.generateInterviewPrep,
  },
] as const;

describe('requireOwner rejects an owner-less request before any read or write', () => {
  const originalEnv = process.env;
  let app: ReturnType<typeof buildApp>;
  let valid: Record<string, string>;

  beforeEach(async () => {
    // Default to the real middleware; only the owner-less block opts in. Reset
    // here rather than in `afterEach` alone so a failure mid-test cannot leak
    // the injection into the "caller with a sub" cases and make them pass for
    // the wrong reason.
    inject.ownerless = false;
    process.env = { ...originalEnv, SUPABASE_JWT_SECRET: JWT_SECRET };
    _resetConfig();
    _resetJwksCache();
    vi.clearAllMocks();
    app = buildApp();

    const encoded = new TextEncoder().encode(JWT_SECRET);

    const withSub = await new SignJWT({ sub: '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(encoded);
    valid = { 'content-type': 'application/json', authorization: `Bearer ${withSub}` };
  });

  afterEach(() => {
    inject.ownerless = false;
    process.env = originalEnv;
    _resetConfig();
    _resetJwksCache();
  });

  it.each(GUARDED)('$name rejects an owner-less caller and calls nothing', async (entry) => {
    // Inject the absence at the middleware boundary. Nothing in the real app
    // produces one any more — the sub-less token is rejected by
    // `middleware/auth.ts` (WIC-1554) and the local-dev bypass now resolves a
    // real owner (ADR-010 D3) — so this is the guard's defence-in-depth
    // contract: whatever puts a null owner on the context, the route stops
    // before the service. Injecting it here rather than through the bypass is
    // what keeps this test about `requireOwner` instead of about auth config.
    inject.ownerless = true;
    const ownerlessApp = buildApp();

    const response = await ownerlessApp.request(entry.path, {
      method: entry.method,
      headers: { 'content-type': 'application/json' },
      ...(entry.body === undefined ? {} : { body: JSON.stringify(entry.body) }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'OWNER_REQUIRED' } });
    // The load-bearing assertion: the request never reached the data layer.
    expect(entry.service()).not.toHaveBeenCalled();
  });

  // AC-5: the guard must be invisible to a caller that already carries an owner.
  // Without this, deleting the whole route body would still pass the block above.
  it.each(GUARDED)('$name still reaches the service for a caller with a sub', async (entry) => {
    const response = await app.request(entry.path, {
      method: entry.method,
      headers: valid,
      ...(entry.body === undefined ? {} : { body: JSON.stringify(entry.body) }),
    });

    expect(response.status).not.toBe(401);
    expect(entry.service()).toHaveBeenCalledTimes(1);
    // The resolved owner is the last argument at every one of these call sites.
    const args = vi.mocked(entry.service()).mock.calls[0];
    expect(args[args.length - 1]).toBe('8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60');
  });
});
