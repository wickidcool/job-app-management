import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

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
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  // ── GET /api/catalog/diffs ──────────────────────────────────────────────────

  describe('GET /api/catalog/diffs', () => {
    it('returns 200 with plain array of diffs', async () => {
      vi.mocked(catalogService.listDiffs).mockResolvedValue({
        diffs: [mockDiff],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/diffs', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([mockDiff]);
      expect(catalogService.listDiffs).toHaveBeenCalledWith(
        {
          status: undefined,
          limit: undefined,
          cursor: undefined,
        },
        undefined
      );
    });

    it('filters by status query param', async () => {
      vi.mocked(catalogService.listDiffs).mockResolvedValue({ diffs: [], nextCursor: undefined });

      const response = await app.request('/api/catalog/diffs?status=approved', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(catalogService.listDiffs).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
        undefined
      );
    });

    it('returns empty array when no diffs exist', async () => {
      vi.mocked(catalogService.listDiffs).mockResolvedValue({ diffs: [], nextCursor: undefined });

      const response = await app.request('/api/catalog/diffs', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
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
        undefined
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
        undefined
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
      expect(catalogService.discardDiff).toHaveBeenCalledWith('01HZ_DIFF_001', undefined);
    });

    it('returns 404 when diff not found', async () => {
      vi.mocked(catalogService.discardDiff).mockRejectedValue(new NotFoundError('CatalogDiff'));

      const response = await app.request('/api/catalog/diffs/nonexistent', { method: 'DELETE' });

      expect(response.status).toBe(404);
    });
  });

  // ── GET /api/catalog/companies ─────────────────────────────────────────────

  describe('GET /api/catalog/companies', () => {
    it('returns 200 with plain array of companies', async () => {
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
      expect(await response.json()).toEqual([mockCompany]);
    });
  });

  // ── GET /api/catalog/tags/:type ────────────────────────────────────────────

  describe('GET /api/catalog/tags/tech-stack', () => {
    it('returns 200 with plain array of tech stack tags', async () => {
      vi.mocked(catalogService.listTechStackTags).mockResolvedValue({
        tags: [mockTag],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/tags/tech-stack', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([mockTag]);
    });
  });

  describe('GET /api/catalog/tags/job-fit', () => {
    it('returns 200 with plain array of job fit tags', async () => {
      vi.mocked(catalogService.listJobFitTags).mockResolvedValue({
        tags: [mockTag],
        nextCursor: undefined,
      });

      const response = await app.request('/api/catalog/tags/job-fit', { method: 'GET' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([mockTag]);
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
    it('returns 200 with plain array of bullets', async () => {
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
      expect(await response.json()).toEqual([mockBullet]);
    });
  });

  // ── GET /api/catalog/themes ────────────────────────────────────────────────

  describe('GET /api/catalog/themes', () => {
    it('returns 200 with plain array of themes', async () => {
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
      expect(await response.json()).toEqual([mockTheme]);
    });
  });
});
