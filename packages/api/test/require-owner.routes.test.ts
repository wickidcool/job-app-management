import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import { _resetConfig } from '../src/config.js';
import { _resetJwksCache } from '../src/middleware/auth.js';

/**
 * WIC-1638 / ADR-010 AC-4 — the owner-absent request reads and writes nothing.
 *
 * The services these routes call now take `userId: string`, so the owner-absent
 * branch is gone from every predicate. That alone is not the guarantee, because
 * a route can still *manufacture* an absence: the shape being retired here is
 * literally `c.get('userId') ?? undefined`, which laundered a null owner into an
 * optional argument and pushed the decision down into the predicate.
 *
 * `requireOwner` is the single place that absence is turned into an error. These
 * tests drive the real Hono app with a JWT that verifies but carries no `sub`
 * claim — the WIC-1554 case, where `middleware/auth.ts` resolves `userId` to
 * `null` — and assert two things per entry point:
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

vi.mock('../src/services/catalog.service.js', () => ({
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

vi.mock('../src/services/resume-variant.service.js', () => ({
  generateResumeVariant: vi.fn(),
  listResumeVariants: vi.fn(),
  getResumeVariant: vi.fn(),
  updateResumeVariant: vi.fn(),
  deleteResumeVariant: vi.fn(),
  reviseResumeVariant: vi.fn(),
  suggestBullets: vi.fn(),
  exportResumeVariant: vi.fn(),
}));

vi.mock('../src/services/interviewPrep.service.js', () => ({
  generateInterviewPrep: vi.fn(),
  listInterviewPreps: vi.fn(),
  getInterviewPrep: vi.fn(),
  updateInterviewPrep: vi.fn(),
  addStory: vi.fn(),
  updateStory: vi.fn(),
  logPracticeSession: vi.fn(),
  deleteInterviewPrep: vi.fn(),
}));

vi.mock('../src/services/job-fit.service.js', () => ({ analyzeJobFit: vi.fn() }));

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
  let subless: Record<string, string>;
  let valid: Record<string, string>;

  beforeEach(async () => {
    process.env = { ...originalEnv, SUPABASE_JWT_SECRET: JWT_SECRET };
    _resetConfig();
    _resetJwksCache();
    vi.clearAllMocks();
    app = buildApp();

    const encoded = new TextEncoder().encode(JWT_SECRET);
    // Verifies against the secret, but carries no `sub`. `middleware/auth.ts`
    // resolves this to `userId: null` (WIC-1554) — an authenticated caller with
    // no identity, which is precisely what the old `?? undefined` laundered.
    const noSub = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(encoded);
    subless = { 'content-type': 'application/json', authorization: `Bearer ${noSub}` };

    const withSub = await new SignJWT({ sub: '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(encoded);
    valid = { 'content-type': 'application/json', authorization: `Bearer ${withSub}` };
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfig();
    _resetJwksCache();
  });

  it.each(GUARDED)('$name rejects a sub-less caller and calls nothing', async (entry) => {
    const response = await app.request(entry.path, {
      method: entry.method,
      headers: subless,
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
