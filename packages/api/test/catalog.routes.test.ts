import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import {
  buildAuthedApp,
  resetAuthEnv,
  TEST_USER_ID,
  type AuthedApp,
} from './helpers/authed-app.js';
import { _resetConfig } from '../src/config.js';
import { _resetJwksCache } from '../src/middleware/auth.js';

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

vi.mock('../src/services/job-fit.service.js', () => ({
  analyzeJobFit: vi.fn(),
}));

vi.mock('../src/services/application.service.js', () => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));

vi.mock('../src/services/resume.service.js', () => ({
  uploadResume: vi.fn(),
  listResumes: vi.fn(),
  listResumeExports: vi.fn(),
  getResumeExport: vi.fn(),
  deleteResume: vi.fn(),
}));

vi.mock('../src/services/dashboard.service.js', () => ({
  getDashboardStats: vi.fn(),
}));

import * as catalogService from '../src/services/catalog.service.js';
import { NotFoundError } from '../src/types/index.js';

const mockDiff = {
  id: '01HZ_DIFF_001',
  triggerSource: 'resume_upload',
  triggerId: '01HZ_RESUME_001',
  summary: '2 new tags extracted',
  changeCount: 2,
  pendingReviewCount: 0,
  status: 'pending' as const,
  createdAt: '2026-04-24T20:00:00.000Z',
  expiresAt: '2026-05-01T20:00:00.000Z',
  changes: [
    {
      entity: 'tech_stack_tags',
      action: 'create' as const,
      data: { id: '01HZ_TAG_001', tagSlug: 'react', displayName: 'React' },
    },
  ],
  pendingReview: [],
};

const mockTag = {
  id: '01HZ_TAG_001',
  tagSlug: 'react',
  displayName: 'React',
  category: 'frontend' as const,
  mentionCount: 3,
  needsReview: false,
  version: 1,
};

describe('Catalog Routes', () => {
  // Authenticated: these routes call `requireOwner`, so an owner-less request
  // is a 401 and never reaches the service (WIC-1638). See helpers/authed-app.
  let app: AuthedApp;

  beforeEach(async () => {
    app = await buildAuthedApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetAuthEnv();
  });

  // ── GET /api/catalog/diffs ──────────────────────────────────────────────────

  describe('GET /api/catalog/diffs', () => {
    it('returns 200 with the documented { diffs } envelope', async () => {
      vi.mocked(catalogService.listDiffs).mockResolvedValue({
        diffs: [mockDiff],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/diffs', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ diffs: [mockDiff] });
      expect(catalogService.listDiffs).toHaveBeenCalledWith(
        {
          status: undefined,
          limit: undefined,
          cursor: undefined,
        },
        TEST_USER_ID
      );
    });

    it('filters by status query param', async () => {
      vi.mocked(catalogService.listDiffs).mockResolvedValue({ diffs: [], nextCursor: undefined });

      const response = await app.request('/api/catalog/diffs?status=approved', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(catalogService.listDiffs).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
        TEST_USER_ID
      );
    });

    it('returns an empty diffs array when no diffs exist', async () => {
      vi.mocked(catalogService.listDiffs).mockResolvedValue({ diffs: [], nextCursor: undefined });

      const response = await app.request('/api/catalog/diffs', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ diffs: [] });
    });
  });

  // ── GET /api/catalog/diffs/:id ─────────────────────────────────────────────

  describe('GET /api/catalog/diffs/:id', () => {
    it('returns 200 with diff object directly (no envelope)', async () => {
      vi.mocked(catalogService.getDiff).mockResolvedValue(mockDiff);

      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001', { method: 'GET' });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('01HZ_DIFF_001');
      expect(body.diff).toBeUndefined();
    });

    it('returns 404 when diff not found', async () => {
      vi.mocked(catalogService.getDiff).mockRejectedValue(new NotFoundError('CatalogDiff'));

      const response = await app.request('/api/catalog/diffs/nonexistent', { method: 'GET' });

      expect(response.status).toBe(404);
    });
  });

  // ── POST /api/catalog/generate-diff ───────────────────────────────────────

  describe('POST /api/catalog/generate-diff', () => {
    it('returns 201 with generated diff', async () => {
      vi.mocked(catalogService.generateDiff).mockResolvedValue(mockDiff);

      const response = await app.request('/api/catalog/generate-diff', {
        method: 'POST',
        body: JSON.stringify({ sourceType: 'resume', sourceId: '01HZ_RESUME_001' }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(mockDiff);
      expect(catalogService.generateDiff).toHaveBeenCalledWith(
        'resume',
        '01HZ_RESUME_001',
        TEST_USER_ID
      );
    });
  });

  // ── POST /api/catalog/diffs/:id/apply ─────────────────────────────────────

  describe('POST /api/catalog/diffs/:id/apply', () => {
    it('approve_all returns applied count and approved status', async () => {
      vi.mocked(catalogService.applyDiff).mockResolvedValue({
        applied: 2,
        rejected: 0,
        pendingReview: 0,
        status: 'approved',
      });

      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/apply', {
        method: 'POST',
        body: JSON.stringify({ action: 'approve_all' }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ applied: 2, status: 'approved' });
      expect(catalogService.applyDiff).toHaveBeenCalledWith(
        '01HZ_DIFF_001',
        { action: 'approve_all' },
        TEST_USER_ID
      );
    });

    it('reject_all returns rejected count and rejected status', async () => {
      vi.mocked(catalogService.applyDiff).mockResolvedValue({
        applied: 0,
        rejected: 2,
        pendingReview: 0,
        status: 'rejected',
      });

      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/apply', {
        method: 'POST',
        body: JSON.stringify({ action: 'reject_all' }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ applied: 0, status: 'rejected' });
    });

    it('partial returns partial status when some approved, some rejected', async () => {
      vi.mocked(catalogService.applyDiff).mockResolvedValue({
        applied: 1,
        rejected: 1,
        pendingReview: 0,
        status: 'partial',
      });

      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/apply', {
        method: 'POST',
        body: JSON.stringify({
          action: 'partial',
          decisions: [
            { changeIndex: 0, approved: true },
            { changeIndex: 1, approved: false },
          ],
        }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ applied: 1, rejected: 1, status: 'partial' });
    });

    it('returns 404 when diff not found', async () => {
      vi.mocked(catalogService.applyDiff).mockRejectedValue(new NotFoundError('CatalogDiff'));

      const response = await app.request('/api/catalog/diffs/nonexistent/apply', {
        method: 'POST',
        body: JSON.stringify({ action: 'approve_all' }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(404);
    });
  });

  // ── DELETE /api/catalog/diffs/:id ─────────────────────────────────────────

  describe('DELETE /api/catalog/diffs/:id', () => {
    it('returns 204 on successful discard', async () => {
      vi.mocked(catalogService.discardDiff).mockResolvedValue(undefined);

      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001', { method: 'DELETE' });

      expect(response.status).toBe(204);
      expect(catalogService.discardDiff).toHaveBeenCalledWith('01HZ_DIFF_001', TEST_USER_ID);
    });

    it('returns 404 when diff not found', async () => {
      vi.mocked(catalogService.discardDiff).mockRejectedValue(new NotFoundError('CatalogDiff'));

      const response = await app.request('/api/catalog/diffs/nonexistent', { method: 'DELETE' });

      expect(response.status).toBe(404);
    });
  });

  // ── GET /api/catalog/companies ─────────────────────────────────────────────

  describe('GET /api/catalog/companies', () => {
    it('returns 200 with the documented { companies } envelope', async () => {
      const mockCompany = {
        id: '01HZ_CO_001',
        name: 'Acme Corp',
        normalizedName: 'acme-corp',
        aliases: [],
        firstSeenAt: '2026-04-01T00:00:00.000Z',
        applicationCount: 2,
        latestStatus: 'applied',
        isDeleted: false,
        version: 1,
      };
      vi.mocked(catalogService.listCompanies).mockResolvedValue({
        companies: [mockCompany],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/companies', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ companies: [mockCompany] });
    });
  });

  // ── GET /api/catalog/tags/:type ────────────────────────────────────────────

  describe('GET /api/catalog/tags/tech-stack', () => {
    it('returns 200 with the documented { tags } envelope', async () => {
      vi.mocked(catalogService.listTechStackTags).mockResolvedValue({
        tags: [mockTag],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/tags/tech-stack', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ tags: [mockTag] });
    });
  });

  describe('GET /api/catalog/tags/job-fit', () => {
    it('returns 200 with the documented { tags } envelope', async () => {
      vi.mocked(catalogService.listJobFitTags).mockResolvedValue({
        tags: [mockTag],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/tags/job-fit', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ tags: [mockTag] });
    });
  });

  describe('GET /api/catalog/tags/:type — invalid type', () => {
    it('returns 400 for unknown tag type', async () => {
      const response = await app.request('/api/catalog/tags/unknown', { method: 'GET' });
      expect(response.status).toBe(400);
    });
  });

  // ── PATCH /api/catalog/tags/:type/:id — version conflict ──────────────────

  describe('PATCH /api/catalog/tags/tech-stack/:id', () => {
    it('returns updated tag on success', async () => {
      const updated = { ...mockTag, displayName: 'React 18', version: 2 };
      vi.mocked(catalogService.updateTechStackTag).mockResolvedValue(updated);

      const response = await app.request('/api/catalog/tags/tech-stack/01HZ_TAG_001', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'React 18', version: 1 }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(200);
      expect((await response.json()).displayName).toBe('React 18');
    });

    it('returns 404 on version conflict', async () => {
      vi.mocked(catalogService.updateTechStackTag).mockRejectedValue(
        new NotFoundError('TechStackTag (version conflict)')
      );

      const response = await app.request('/api/catalog/tags/tech-stack/01HZ_TAG_001', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'React 18', version: 99 }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/catalog/tags/job-fit/:id', () => {
    it('returns updated tag on success', async () => {
      const updated = { ...mockTag, needsReview: false, version: 2 };
      vi.mocked(catalogService.updateJobFitTag).mockResolvedValue(updated);

      const response = await app.request('/api/catalog/tags/job-fit/01HZ_TAG_001', {
        method: 'PATCH',
        body: JSON.stringify({ needsReview: false, version: 1 }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(200);
    });

    it('returns 404 on version conflict', async () => {
      vi.mocked(catalogService.updateJobFitTag).mockRejectedValue(
        new NotFoundError('JobFitTag (version conflict)')
      );

      const response = await app.request('/api/catalog/tags/job-fit/01HZ_TAG_001', {
        method: 'PATCH',
        body: JSON.stringify({ needsReview: false, version: 99 }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      });

      expect(response.status).toBe(404);
    });
  });

  // ── GET /api/catalog/quantified-bullets ───────────────────────────────────

  describe('GET /api/catalog/quantified-bullets', () => {
    it('returns 200 with the documented { bullets } envelope', async () => {
      const mockBullet = {
        id: '01HZ_BULLET_001',
        sourceType: 'resume',
        sourceId: '01HZ_RESUME_001',
        rawText: 'Increased conversion by 25%',
        actionVerb: 'Increased',
        metricType: 'percentage',
        metricValue: '25',
        isApproximate: false,
        secondaryMetricType: null,
        secondaryMetricValue: null,
        impactCategory: 'revenue',
        extractedAt: '2026-04-24T20:00:00.000Z',
      };
      vi.mocked(catalogService.listBullets).mockResolvedValue({
        bullets: [mockBullet],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/quantified-bullets', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ bullets: [mockBullet] });
    });
  });

  // ── GET /api/catalog/themes ────────────────────────────────────────────────

  describe('GET /api/catalog/themes', () => {
    it('returns 200 with the documented { themes } envelope', async () => {
      const mockTheme = {
        id: '01HZ_THEME_001',
        themeSlug: 'team-leadership',
        displayName: 'Team Leadership',
        occurrenceCount: 4,
        sourceIds: ['01HZ_RESUME_001'],
        exampleExcerpts: ['Led a team of 5 engineers'],
        isCoreStrength: true,
        isHistorical: false,
        lastSeenAt: '2026-04-24T20:00:00.000Z',
      };
      vi.mocked(catalogService.listThemes).mockResolvedValue({
        themes: [mockTheme],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/themes', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ themes: [mockTheme] });
    });
  });

  // ── nextCursor propagation ─────────────────────────────────────────────────
  //
  // Every catalog list service computes a `nextCursor`; every one of these
  // routes used to destructure the items out and drop it on the floor
  // (WIC-1336). The envelope assertions above do not catch that on their own —
  // a route returning `c.json({ diffs })` satisfies every one of them, because
  // their fixtures all leave `nextCursor` undefined and `toEqual` treats an
  // undefined property as absent. Each case here therefore mints a *defined*
  // cursor and requires it to survive the trip through the route.
  describe('nextCursor survives every catalog list route', () => {
    const LIST_ROUTES = [
      ['listDiffs', '/api/catalog/diffs', 'diffs'],
      ['listCompanies', '/api/catalog/companies', 'companies'],
      ['listJobFitTags', '/api/catalog/tags/job-fit', 'tags'],
      ['listTechStackTags', '/api/catalog/tags/tech-stack', 'tags'],
      ['listBullets', '/api/catalog/quantified-bullets', 'bullets'],
      ['listThemes', '/api/catalog/themes', 'themes'],
    ] as const;

    // Guards the guard. `LIST_ROUTES` is hand-maintained, so on its own it can
    // only claim to be exhaustive; this counts. A catalog list endpoint that
    // lands without a row fails here rather than quietly shrinking the claim
    // above — the failure mode that cost WIC-1335 a quarter of its coverage.
    it('covers every catalog service function that mints a cursor', async () => {
      const { readFile } = await import('node:fs/promises');
      const source = await readFile(
        new URL('../src/services/catalog.service.ts', import.meta.url),
        'utf-8'
      );

      const minters = source
        .split('export async function ')
        .slice(1)
        .filter((body) => body.includes('nextCursor'))
        .map((body) => body.slice(0, body.indexOf('(')));

      expect(new Set(minters)).toEqual(new Set(LIST_ROUTES.map(([fn]) => fn)));
      expect(minters).toHaveLength(LIST_ROUTES.length);
    });

    it.each(LIST_ROUTES)('%s returns nextCursor at %s', async (fn, path, itemsKey) => {
      vi.mocked(catalogService[fn]).mockResolvedValue({
        [itemsKey]: [],
        nextCursor: 'MTA',
      } as never);

      const response = await app.request(path, { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ [itemsKey]: [], nextCursor: 'MTA' });
    });
  });

  // ── POST /api/catalog/companies/merge ─────────────────────────────────────
  //
  // UC-2's first named integrity constraint: "no duplicate entries across
  // companies". These cover the route contract; the merge arithmetic itself
  // (summing applicationCount, union of aliases) is covered in
  // catalog.service.test.ts, which can see the DB writes.

  describe('POST /api/catalog/companies/merge', () => {
    const mergedCompany = {
      id: '01HZ_CO_001',
      name: 'Acme Corp',
      normalizedName: 'acme-corp',
      aliases: ['Acme Corporation', 'ACME'],
      firstSeen: '2026-04-01T00:00:00.000Z',
      applicationCount: 5,
      latestStatus: 'applied',
      isDeleted: false,
      version: 2,
    };

    it('merges sources into the target and returns the merged company', async () => {
      vi.mocked(catalogService.mergeCompanies).mockResolvedValue({
        mergedCompany,
        mergedCount: 2,
      });

      const response = await app.request('/api/catalog/companies/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceCompanyIds: ['01HZ_CO_002', '01HZ_CO_003'],
          targetCompanyId: '01HZ_CO_001',
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.mergedCount).toBe(2);
      expect(body.mergedCompany.applicationCount).toBe(5);
      expect(catalogService.mergeCompanies).toHaveBeenCalledWith(
        ['01HZ_CO_002', '01HZ_CO_003'],
        '01HZ_CO_001',
        TEST_USER_ID
      );
    });

    it('returns 400 when sourceCompanyIds is empty', async () => {
      const response = await app.request('/api/catalog/companies/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceCompanyIds: [], targetCompanyId: '01HZ_CO_001' }),
      });

      expect(response.status).toBe(400);
      expect(catalogService.mergeCompanies).not.toHaveBeenCalled();
    });

    it('returns 400 when targetCompanyId is missing', async () => {
      const response = await app.request('/api/catalog/companies/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceCompanyIds: ['01HZ_CO_002'] }),
      });

      expect(response.status).toBe(400);
      expect(catalogService.mergeCompanies).not.toHaveBeenCalled();
    });

    it('returns 404 when the merge target does not exist', async () => {
      vi.mocked(catalogService.mergeCompanies).mockRejectedValue(new NotFoundError('Company'));

      const response = await app.request('/api/catalog/companies/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceCompanyIds: ['01HZ_CO_002'],
          targetCompanyId: 'nonexistent',
        }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ── POST /api/catalog/tags/:type/merge ────────────────────────────────────
  //
  // UC-2's second named constraint: tag taxonomy consistency (the AI-ML vs
  // ai-ml drift case). Merge is the remediation path for drift that already
  // exists in the catalog.

  describe('POST /api/catalog/tags/:type/merge', () => {
    const mergedTag = { ...mockTag, mentionCount: 9, aliases: ['ai-ml'], version: 2 };

    it('merges job-fit tags and returns the surviving tag', async () => {
      vi.mocked(catalogService.mergeJobFitTags).mockResolvedValue({
        mergedTag,
        mergedCount: 1,
      });

      const response = await app.request('/api/catalog/tags/job-fit/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTagIds: ['01HZ_TAG_002'], targetTagId: '01HZ_TAG_001' }),
      });

      expect(response.status).toBe(200);
      expect((await response.json()).mergedCount).toBe(1);
      expect(catalogService.mergeJobFitTags).toHaveBeenCalledWith(
        ['01HZ_TAG_002'],
        '01HZ_TAG_001',
        TEST_USER_ID
      );
      expect(catalogService.mergeTechStackTags).not.toHaveBeenCalled();
    });

    it('merges tech-stack tags and returns the surviving tag', async () => {
      vi.mocked(catalogService.mergeTechStackTags).mockResolvedValue({
        mergedTag,
        mergedCount: 1,
      });

      // The spec's own example: a drifted `AI-ML` folded into canonical `ai-ml`.
      const response = await app.request('/api/catalog/tags/tech-stack/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTagIds: ['01HZ_TAG_AI_ML'], targetTagId: '01HZ_TAG_001' }),
      });

      expect(response.status).toBe(200);
      expect(catalogService.mergeTechStackTags).toHaveBeenCalledWith(
        ['01HZ_TAG_AI_ML'],
        '01HZ_TAG_001',
        TEST_USER_ID
      );
      expect(catalogService.mergeJobFitTags).not.toHaveBeenCalled();
    });

    it('returns 400 for an unknown tag type', async () => {
      const response = await app.request('/api/catalog/tags/unknown/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTagIds: ['01HZ_TAG_002'], targetTagId: '01HZ_TAG_001' }),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe('type must be job-fit or tech-stack');
      expect(catalogService.mergeJobFitTags).not.toHaveBeenCalled();
      expect(catalogService.mergeTechStackTags).not.toHaveBeenCalled();
    });

    it('returns 400 when sourceTagIds is empty', async () => {
      const response = await app.request('/api/catalog/tags/job-fit/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTagIds: [], targetTagId: '01HZ_TAG_001' }),
      });

      expect(response.status).toBe(400);
      expect(catalogService.mergeJobFitTags).not.toHaveBeenCalled();
    });

    it('returns 404 when the merge target tag does not exist', async () => {
      vi.mocked(catalogService.mergeJobFitTags).mockRejectedValue(new NotFoundError('JobFitTag'));

      const response = await app.request('/api/catalog/tags/job-fit/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTagIds: ['01HZ_TAG_002'], targetTagId: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ── POST /api/catalog/diffs/:id/resolve ───────────────────────────────────

  describe('POST /api/catalog/diffs/:id/resolve', () => {
    it('records a change decision and echoes the diff id', async () => {
      vi.mocked(catalogService.resolveDiffItem).mockResolvedValue({
        id: '01HZ_DIFF_001',
        updated: true,
      });

      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType: 'change', itemIndex: 0, decision: 'approve' }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: '01HZ_DIFF_001', updated: true });
      expect(catalogService.resolveDiffItem).toHaveBeenCalledWith(
        '01HZ_DIFF_001',
        { itemType: 'change', itemIndex: 0, decision: 'approve' },
        TEST_USER_ID
      );
    });

    it('forwards selectedOption for a review item', async () => {
      vi.mocked(catalogService.resolveDiffItem).mockResolvedValue({
        id: '01HZ_DIFF_001',
        updated: true,
      });

      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemType: 'review',
          itemIndex: 2,
          decision: 'reject',
          selectedOption: 'ai-ml',
        }),
      });

      expect(response.status).toBe(200);
      expect(catalogService.resolveDiffItem).toHaveBeenCalledWith(
        '01HZ_DIFF_001',
        { itemType: 'review', itemIndex: 2, decision: 'reject', selectedOption: 'ai-ml' },
        TEST_USER_ID
      );
    });

    it('returns 400 for a decision outside approve/reject', async () => {
      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType: 'change', itemIndex: 0, decision: 'maybe' }),
      });

      expect(response.status).toBe(400);
      expect(catalogService.resolveDiffItem).not.toHaveBeenCalled();
    });

    it('returns 400 for an unknown itemType', async () => {
      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType: 'bullet', itemIndex: 0, decision: 'approve' }),
      });

      expect(response.status).toBe(400);
      expect(catalogService.resolveDiffItem).not.toHaveBeenCalled();
    });

    it('returns 400 for a negative itemIndex', async () => {
      const response = await app.request('/api/catalog/diffs/01HZ_DIFF_001/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType: 'change', itemIndex: -1, decision: 'approve' }),
      });

      expect(response.status).toBe(400);
      expect(catalogService.resolveDiffItem).not.toHaveBeenCalled();
    });

    it('returns 404 when the diff does not exist', async () => {
      vi.mocked(catalogService.resolveDiffItem).mockRejectedValue(new NotFoundError('CatalogDiff'));

      const response = await app.request('/api/catalog/diffs/nonexistent/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemType: 'change', itemIndex: 0, decision: 'approve' }),
      });

      expect(response.status).toBe(404);
    });
  });
});

// ── Merge routes under auth (WIC-1365) ──────────────────────────────────────
//
// The cases above run with SUPABASE_JWT_SECRET unset, so `userId` is null and
// the third argument is `undefined` — right for the harness, but it reads as
// "the user id is not part of the merge contract". It is: the merge services
// scope every read and write by it. These pin the other half of the contract,
// that the authenticated caller's `sub` is what reaches the service.

const MERGE_JWT_SECRET = 'super-secret-jwt-key-for-testing-only-32-chars!!';
const CALLER_SUB = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

describe('Catalog merge routes thread the authenticated user id', () => {
  const originalEnv = process.env;
  let app: ReturnType<typeof buildApp>;
  let auth: Record<string, string>;

  beforeEach(async () => {
    process.env = { ...originalEnv, SUPABASE_JWT_SECRET: MERGE_JWT_SECRET };
    _resetConfig();
    _resetJwksCache();
    vi.clearAllMocks();
    app = buildApp();

    const token = await new SignJWT({ sub: CALLER_SUB })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(MERGE_JWT_SECRET));
    auth = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfig();
    _resetJwksCache();
  });

  it('passes the caller sub to mergeCompanies', async () => {
    vi.mocked(catalogService.mergeCompanies).mockResolvedValue({
      mergedCompany: {
        id: '01HZ_CO_001',
        name: 'Acme Corp',
        normalizedName: 'acme-corp',
        aliases: [],
        firstSeen: '2026-04-01T00:00:00.000Z',
        applicationCount: 5,
        latestStatus: 'applied',
        isDeleted: false,
        version: 2,
      },
      mergedCount: 1,
    });

    const response = await app.request('/api/catalog/companies/merge', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        sourceCompanyIds: ['01HZ_CO_002'],
        targetCompanyId: '01HZ_CO_001',
      }),
    });

    expect(response.status).toBe(200);
    expect(catalogService.mergeCompanies).toHaveBeenCalledWith(
      ['01HZ_CO_002'],
      '01HZ_CO_001',
      CALLER_SUB
    );
  });

  it.each([
    ['job-fit', 'mergeJobFitTags'],
    ['tech-stack', 'mergeTechStackTags'],
  ] as const)('passes the caller sub to %s merge', async (type, fn) => {
    vi.mocked(catalogService[fn]).mockResolvedValue({
      mergedTag: { ...mockTag, mentionCount: 9, aliases: ['ai-ml'], version: 2 },
      mergedCount: 1,
    });

    const response = await app.request(`/api/catalog/tags/${type}/merge`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ sourceTagIds: ['01HZ_TAG_002'], targetTagId: '01HZ_TAG_001' }),
    });

    expect(response.status).toBe(200);
    expect(catalogService[fn]).toHaveBeenCalledWith(['01HZ_TAG_002'], '01HZ_TAG_001', CALLER_SUB);
  });

  // ── WIC-1373 ──────────────────────────────────────────────────────────────
  // Same contract on the tag PATCH routes and generate-diff. These services
  // also took `userId` and dropped it; pin that the caller's sub reaches them.

  it.each([
    ['job-fit', 'updateJobFitTag'],
    ['tech-stack', 'updateTechStackTag'],
  ] as const)('passes the caller sub to %s tag update', async (type, fn) => {
    vi.mocked(catalogService[fn]).mockResolvedValue({ ...mockTag, displayName: 'Renamed' });

    const response = await app.request(`/api/catalog/tags/${type}/01HZ_TAG_001`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ displayName: 'Renamed', version: 1 }),
    });

    expect(response.status).toBe(200);
    expect(catalogService[fn]).toHaveBeenCalledWith(
      '01HZ_TAG_001',
      { displayName: 'Renamed', version: 1 },
      CALLER_SUB
    );
  });

  it('passes the caller sub to generateDiff', async () => {
    vi.mocked(catalogService.generateDiff).mockResolvedValue(mockDiff);

    const response = await app.request('/api/catalog/generate-diff', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ sourceType: 'resume', sourceId: '01HZ_RESUME_001' }),
    });

    expect(response.status).toBe(201);
    expect(catalogService.generateDiff).toHaveBeenCalledWith(
      'resume',
      '01HZ_RESUME_001',
      CALLER_SUB
    );
  });

  it.each([
    ['/api/catalog/companies/merge', { sourceCompanyIds: ['01HZ_CO_002'], targetCompanyId: 'x' }],
    ['/api/catalog/tags/job-fit/merge', { sourceTagIds: ['01HZ_TAG_002'], targetTagId: 'x' }],
    ['/api/catalog/tags/tech-stack/merge', { sourceTagIds: ['01HZ_TAG_002'], targetTagId: 'x' }],
  ])('rejects %s with no bearer token before any merge runs', async (path, body) => {
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(401);
    expect(catalogService.mergeCompanies).not.toHaveBeenCalled();
    expect(catalogService.mergeJobFitTags).not.toHaveBeenCalled();
    expect(catalogService.mergeTechStackTags).not.toHaveBeenCalled();
  });
});
