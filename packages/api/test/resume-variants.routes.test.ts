import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/resume-variant.service.js', () => ({
  generateResumeVariant: vi.fn(),
  getResumeVariant: vi.fn(),
  listResumeVariants: vi.fn(),
  updateResumeVariant: vi.fn(),
  deleteResumeVariant: vi.fn(),
  reviseResumeVariant: vi.fn(),
  suggestBullets: vi.fn(),
  exportResumeVariant: vi.fn(),
}));

vi.mock('../src/services/application.service.js', () => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));

vi.mock('../src/services/dashboard.service.js', () => ({ getDashboardStats: vi.fn() }));

vi.mock('../src/services/resume.service.js', () => ({
  uploadResume: vi.fn(),
  listResumes: vi.fn(),
  listResumeExports: vi.fn(),
  getResumeExport: vi.fn(),
  deleteResume: vi.fn(),
}));

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

vi.mock('../src/services/job-fit.service.js', () => ({ analyzeJobFit: vi.fn() }));

import * as variantService from '../src/services/resume-variant.service.js';
import { NotFoundError, VersionConflictError, ResumeVariantError } from '../src/types/index.js';

const mockVariant = {
  id: '01HZ_VAR_001',
  status: 'draft' as const,
  title: 'Senior Engineer at Acme',
  targetCompany: 'Acme Corp',
  targetRole: 'Senior Engineer',
  format: 'chronological' as const,
  sectionEmphasis: 'balanced' as const,
  baseResumeId: null,
  jobFitAnalysisId: null,
  jobDescriptionText: 'Build great software with a strong engineering team.',
  jobDescriptionUrl: null,
  selectedBullets: [],
  selectedTechTags: [],
  selectedThemes: [],
  sectionOrder: [],
  hiddenSections: [],
  content: { summary: 'Experienced engineer', sections: [] },
  atsScore: 82,
  revisionHistory: [],
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
  version: 1,
};

const mockSummary = {
  id: '01HZ_VAR_001',
  status: 'draft' as const,
  title: 'Senior Engineer at Acme',
  targetCompany: 'Acme Corp',
  targetRole: 'Senior Engineer',
  format: 'chronological' as const,
  atsScore: 82,
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

describe('Resume Variants Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp({ logger: false });
    vi.clearAllMocks();
  });

  // ── POST /api/resume-variants/generate ────────────────────────────────────

  describe('POST /api/resume-variants/generate', () => {
    it('returns 201 on success with a job description', async () => {
      vi.mocked(variantService.generateResumeVariant).mockResolvedValue({
        variant: mockVariant,
        usedBullets: [],
        matchedTechTags: [],
        matchedThemes: [],
        atsScore: 82,
        warnings: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/resume-variants/generate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobDescriptionText: 'Build great software with a strong engineering team to ship products fast.',
        }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.variant.id).toBe('01HZ_VAR_001');
      expect(variantService.generateResumeVariant).toHaveBeenCalledOnce();
    });

    it('returns 400 when no job context is provided', async () => {
      vi.mocked(variantService.generateResumeVariant).mockRejectedValue(
        new ResumeVariantError('JOB_CONTEXT_REQUIRED', 'Provide jobDescriptionText, jobDescriptionUrl, or jobFitAnalysisId')
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/resume-variants/generate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('JOB_CONTEXT_REQUIRED');
    });

    it('returns 422 when catalog is empty', async () => {
      vi.mocked(variantService.generateResumeVariant).mockRejectedValue(
        new ResumeVariantError('CATALOG_EMPTY', 'Cannot generate without catalog data', undefined, 422)
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/resume-variants/generate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobDescriptionText: 'Build great software with a strong engineering team to ship products fast.',
        }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('CATALOG_EMPTY');
    });
  });

  // ── GET /api/resume-variants ──────────────────────────────────────────────

  describe('GET /api/resume-variants', () => {
    it('returns 200 with list of variants', async () => {
      vi.mocked(variantService.listResumeVariants).mockResolvedValue({
        variants: [mockSummary],
        nextCursor: undefined,
      });

      const res = await app.inject({ method: 'GET', url: '/api/resume-variants' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.variants).toHaveLength(1);
      expect(variantService.listResumeVariants).toHaveBeenCalledOnce();
    });

    it('passes filter params to service', async () => {
      vi.mocked(variantService.listResumeVariants).mockResolvedValue({
        variants: [],
        nextCursor: undefined,
      });

      await app.inject({
        method: 'GET',
        url: '/api/resume-variants?status=draft&company=Acme&limit=10',
      });

      expect(variantService.listResumeVariants).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', company: 'Acme', limit: 10 })
      );
    });
  });

  // ── GET /api/resume-variants/:id ──────────────────────────────────────────

  describe('GET /api/resume-variants/:id', () => {
    it('returns 200 with variant on success', async () => {
      vi.mocked(variantService.getResumeVariant).mockResolvedValue(mockVariant);

      const res = await app.inject({ method: 'GET', url: '/api/resume-variants/01HZ_VAR_001' });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('01HZ_VAR_001');
    });

    it('returns 404 when variant not found', async () => {
      vi.mocked(variantService.getResumeVariant).mockRejectedValue(
        new NotFoundError('ResumeVariant')
      );

      const res = await app.inject({ method: 'GET', url: '/api/resume-variants/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /api/resume-variants/:id ────────────────────────────────────────

  describe('PATCH /api/resume-variants/:id', () => {
    it('returns 200 with updated variant on success', async () => {
      const updated = { ...mockVariant, title: 'Updated Title', version: 2 };
      vi.mocked(variantService.updateResumeVariant).mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/resume-variants/01HZ_VAR_001',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title', version: 1 }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().variant.title).toBe('Updated Title');
    });

    it('returns 409 on version conflict', async () => {
      vi.mocked(variantService.updateResumeVariant).mockRejectedValue(new VersionConflictError());

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/resume-variants/01HZ_VAR_001',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Stale Update', version: 99 }),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('VERSION_CONFLICT');
    });
  });

  // ── DELETE /api/resume-variants/:id ───────────────────────────────────────

  describe('DELETE /api/resume-variants/:id', () => {
    it('returns 204 on success', async () => {
      vi.mocked(variantService.deleteResumeVariant).mockResolvedValue(undefined);

      const res = await app.inject({ method: 'DELETE', url: '/api/resume-variants/01HZ_VAR_001' });

      expect(res.statusCode).toBe(204);
      expect(variantService.deleteResumeVariant).toHaveBeenCalledWith('01HZ_VAR_001');
    });

    it('returns 404 when variant not found', async () => {
      vi.mocked(variantService.deleteResumeVariant).mockRejectedValue(
        new NotFoundError('ResumeVariant')
      );

      const res = await app.inject({ method: 'DELETE', url: '/api/resume-variants/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/resume-variants/:id/revise ──────────────────────────────────

  describe('POST /api/resume-variants/:id/revise', () => {
    it('returns 200 with revised variant on success', async () => {
      const revised = { ...mockVariant, version: 2 };
      vi.mocked(variantService.reviseResumeVariant).mockResolvedValue(revised);

      const res = await app.inject({
        method: 'POST',
        url: '/api/resume-variants/01HZ_VAR_001/revise',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instructions: 'Focus more on leadership experience and team management skills.',
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().version).toBe(2);
    });

    it('returns 409 on version conflict', async () => {
      vi.mocked(variantService.reviseResumeVariant).mockRejectedValue(new VersionConflictError());

      const res = await app.inject({
        method: 'POST',
        url: '/api/resume-variants/01HZ_VAR_001/revise',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instructions: 'Focus more on leadership experience and team management skills.',
          version: 99,
        }),
      });

      expect(res.statusCode).toBe(409);
    });
  });

  // ── POST /api/resume-variants/suggest-bullets ─────────────────────────────

  describe('POST /api/resume-variants/suggest-bullets', () => {
    it('returns 200 with bullet suggestions', async () => {
      const mockSuggestions = [
        {
          bulletId: '01HZ_BULLET_001',
          rawText: 'Increased system throughput by 40% through query optimization',
          impactCategory: 'performance',
          relevanceScore: 0.85,
          matchedKeywords: ['throughput', 'optimization'],
          suggestedSection: 'experience',
          reasoning: 'Matches JD keywords: throughput, optimization',
        },
      ];

      vi.mocked(variantService.suggestBullets).mockResolvedValue({
        suggestions: mockSuggestions,
        totalCatalogBullets: 42,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/resume-variants/suggest-bullets',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobDescriptionText: 'Build high performance distributed systems with strong engineering and optimization skills.',
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.suggestions).toHaveLength(1);
      expect(body.totalCatalogBullets).toBe(42);
    });
  });
});
