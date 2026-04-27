import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/reports.service.js', () => ({
  getPipelineReport: vi.fn(),
  getNeedsActionReport: vi.fn(),
  getStaleReport: vi.fn(),
  getClosedLoopReport: vi.fn(),
  getByFitTierReport: vi.fn(),
}));

// Silence other service modules pulled in by app.ts
vi.mock('../src/services/application.service.js', () => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));
vi.mock('../src/services/dashboard.service.js', () => ({ getDashboardStats: vi.fn() }));

import * as reportsService from '../src/services/reports.service.js';

const generatedAt = '2026-04-27T00:00:00.000Z';

const mockPipelineResponse = {
  groups: [
    { status: 'saved', count: 1, applications: [{ id: '1', jobTitle: 'SWE', company: 'Acme', location: null, nextAction: null, nextActionDue: null, updatedAt: generatedAt, createdAt: generatedAt }] },
    { status: 'applied', count: 0, applications: [] },
    { status: 'phone_screen', count: 0, applications: [] },
    { status: 'interview', count: 0, applications: [] },
  ],
  totals: { active: 1, byStatus: { saved: 1, applied: 0, phone_screen: 0, interview: 0 } },
  generatedAt,
};

const mockNeedsActionResponse = {
  applications: [],
  summary: { overdue: 0, dueSoon: 0, upcoming: 0, total: 0 },
  generatedAt,
};

const mockStaleResponse = {
  applications: [],
  summary: { total: 0, byStatus: {}, averageDaysStale: 0 },
  generatedAt,
};

const mockClosedLoopResponse = {
  applications: [],
  summary: { total: 0, offers: 0, rejections: 0, withdrawn: 0, rejectionsByStage: [], averageTimeToClose: 0 },
  generatedAt,
};

const mockByFitTierResponse = {
  groups: [
    { tier: 'strong_fit', count: 0, applications: [] },
    { tier: 'moderate_fit', count: 0, applications: [] },
    { tier: 'weak_fit', count: 0, applications: [] },
    { tier: 'not_analyzed', count: 1, applications: [{ id: '1', jobTitle: 'SWE', company: 'Acme', status: 'saved', fitTier: 'not_analyzed', updatedAt: generatedAt }] },
  ],
  summary: { total: 1, analyzed: 0, notAnalyzed: 1, byTier: { not_analyzed: 1 } },
  generatedAt,
};

describe('Reports Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp({ logger: false });
    vi.clearAllMocks();
  });

  describe('GET /api/reports/pipeline', () => {
    it('returns pipeline grouped by status', async () => {
      vi.mocked(reportsService.getPipelineReport).mockResolvedValue(mockPipelineResponse);

      const res = await app.inject({ method: 'GET', url: '/api/reports/pipeline' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.groups).toHaveLength(4);
      expect(body.totals.active).toBe(1);
    });

    it('passes sortBy and sortOrder to service', async () => {
      vi.mocked(reportsService.getPipelineReport).mockResolvedValue(mockPipelineResponse);

      await app.inject({ method: 'GET', url: '/api/reports/pipeline?sortBy=company&sortOrder=asc' });
      expect(reportsService.getPipelineReport).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'company', sortOrder: 'asc' })
      );
    });

    it('returns 400 for invalid sortBy', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/reports/pipeline?sortBy=invalid' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/reports/needs-action', () => {
    it('returns needs-action report', async () => {
      vi.mocked(reportsService.getNeedsActionReport).mockResolvedValue(mockNeedsActionResponse);

      const res = await app.inject({ method: 'GET', url: '/api/reports/needs-action' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary.total).toBe(0);
    });

    it('passes days param to service', async () => {
      vi.mocked(reportsService.getNeedsActionReport).mockResolvedValue(mockNeedsActionResponse);

      await app.inject({ method: 'GET', url: '/api/reports/needs-action?days=14' });
      expect(reportsService.getNeedsActionReport).toHaveBeenCalledWith(
        expect.objectContaining({ days: 14 })
      );
    });

    it('returns 400 for days out of range', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/reports/needs-action?days=999' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/reports/stale', () => {
    it('returns stale report', async () => {
      vi.mocked(reportsService.getStaleReport).mockResolvedValue(mockStaleResponse);

      const res = await app.inject({ method: 'GET', url: '/api/reports/stale' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary.total).toBe(0);
    });

    it('passes days and status params', async () => {
      vi.mocked(reportsService.getStaleReport).mockResolvedValue(mockStaleResponse);

      await app.inject({ method: 'GET', url: '/api/reports/stale?days=7&status=applied' });
      expect(reportsService.getStaleReport).toHaveBeenCalledWith(
        expect.objectContaining({ days: 7, status: 'applied' })
      );
    });
  });

  describe('GET /api/reports/closed-loop', () => {
    it('returns closed-loop report', async () => {
      vi.mocked(reportsService.getClosedLoopReport).mockResolvedValue(mockClosedLoopResponse);

      const res = await app.inject({ method: 'GET', url: '/api/reports/closed-loop' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary.total).toBe(0);
    });

    it('passes period param to service', async () => {
      vi.mocked(reportsService.getClosedLoopReport).mockResolvedValue(mockClosedLoopResponse);

      await app.inject({ method: 'GET', url: '/api/reports/closed-loop?period=30d' });
      expect(reportsService.getClosedLoopReport).toHaveBeenCalledWith(
        expect.objectContaining({ period: '30d' })
      );
    });

    it('returns 400 for invalid period', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/reports/closed-loop?period=1y' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/reports/by-fit-tier', () => {
    it('returns by-fit-tier report with all apps in not_analyzed', async () => {
      vi.mocked(reportsService.getByFitTierReport).mockResolvedValue(mockByFitTierResponse);

      const res = await app.inject({ method: 'GET', url: '/api/reports/by-fit-tier' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary.notAnalyzed).toBe(1);
      expect(body.summary.analyzed).toBe(0);
    });

    it('passes includeTerminal param to service', async () => {
      vi.mocked(reportsService.getByFitTierReport).mockResolvedValue(mockByFitTierResponse);

      await app.inject({ method: 'GET', url: '/api/reports/by-fit-tier?includeTerminal=true' });
      expect(reportsService.getByFitTierReport).toHaveBeenCalledWith(
        expect.objectContaining({ includeTerminal: true })
      );
    });
  });
});
