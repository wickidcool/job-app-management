import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

// Mock the service layer so tests don't need a real DB
vi.mock('../src/services/application.service.js', () => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));

vi.mock('../src/services/dashboard.service.js', () => ({
  getDashboardStats: vi.fn(),
}));

import * as appService from '../src/services/application.service.js';
import { NotFoundError, InvalidTransitionError } from '../src/types/index.js';

const mockApplication = {
  id: '01HXTEST000000000000000001',
  jobTitle: 'Senior Software Engineer',
  company: 'Acme Corp',
  url: 'https://acme.com/jobs/1',
  location: 'Remote',
  salaryRange: '$150k-180k',
  status: 'saved' as const,
  coverLetterId: null,
  resumeVersionId: null,
  createdAt: '2026-04-10T08:00:00.000Z',
  updatedAt: '2026-04-10T08:00:00.000Z',
  appliedAt: null,
  version: 1,
};

describe('Application Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  describe('GET /api/applications', () => {
    it('returns list of applications', async () => {
      vi.mocked(appService.listApplications).mockResolvedValue({
        applications: [mockApplication],
        totalCount: 1,
      });

      const res = await app.request('/api/applications', { method: 'GET' })
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.applications).toHaveLength(1);
      expect(body.totalCount).toBe(1);
    });

    it('passes query params to service', async () => {
      vi.mocked(appService.listApplications).mockResolvedValue({
        applications: [],
        totalCount: 0,
      });

      await app.request('/api/applications?status=applied&sortBy=company&limit=10', { method: 'GET' })

      expect(appService.listApplications).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'applied', sortBy: 'company', limit: 10 }),
        undefined
      );
    });

    it('returns 400 for invalid sort field', async () => {
      const res = await app.request('/api/applications?sortBy=invalid', { method: 'GET' })
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/applications/:id', () => {
    it('returns application with history', async () => {
      vi.mocked(appService.getApplication).mockResolvedValue({
        application: mockApplication,
        statusHistory: [
          {
            fromStatus: null,
            toStatus: 'saved',
            changedAt: '2026-04-10T08:00:00.000Z',
            note: null,
          },
        ],
      });

      const res = await app.request('/api/applications/01HXTEST000000000000000001', { method: 'GET' })
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.application.id).toBe('01HXTEST000000000000000001');
      expect(body.statusHistory).toHaveLength(1);
    });

    it('returns 404 when not found', async () => {
      vi.mocked(appService.getApplication).mockRejectedValue(new NotFoundError('Application'));

      const res = await app.request('/api/applications/nonexistent', { method: 'GET' })
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/applications', () => {
    it('creates an application and returns 201', async () => {
      vi.mocked(appService.createApplication).mockResolvedValue({
        application: mockApplication,
      });

      const res = await app.request('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ jobTitle: 'Senior Software Engineer', company: 'Acme Corp' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(201);
      expect((await res.json()).application.id).toBe(mockApplication.id);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await app.request('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ company: 'Acme Corp' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty jobTitle', async () => {
      const res = await app.request('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ jobTitle: '', company: 'Acme Corp' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/applications/:id', () => {
    it('updates and returns application', async () => {
      const updated = { ...mockApplication, jobTitle: 'Staff Engineer', version: 2 };
      vi.mocked(appService.updateApplication).mockResolvedValue({ application: updated });

      const res = await app.request('/api/applications/01HXTEST000000000000000001', {
        method: 'PATCH',
        body: JSON.stringify({ jobTitle: 'Staff Engineer', version: 1 }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(200);
      expect((await res.json()).application.jobTitle).toBe('Staff Engineer');
    });

    it('returns 400 when version is missing', async () => {
      const res = await app.request('/api/applications/01HXTEST000000000000000001', {
        method: 'PATCH',
        body: JSON.stringify({ jobTitle: 'Staff Engineer' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/applications/:id', () => {
    it('returns 204 on success', async () => {
      vi.mocked(appService.deleteApplication).mockResolvedValue(undefined);

      const res = await app.request('/api/applications/01HXTEST000000000000000001', { method: 'DELETE' })
      expect(res.status).toBe(204);
    });

    it('returns 404 when not found', async () => {
      vi.mocked(appService.deleteApplication).mockRejectedValue(new NotFoundError('Application'));

      const res = await app.request('/api/applications/nonexistent', { method: 'DELETE' })
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/applications/:id/status', () => {
    it('updates status successfully', async () => {
      const updated = { ...mockApplication, status: 'applied' as const, version: 2 };
      vi.mocked(appService.updateApplicationStatus).mockResolvedValue({
        application: updated,
        statusHistory: [
          {
            fromStatus: null,
            toStatus: 'saved',
            changedAt: '2026-04-10T08:00:00.000Z',
            note: null,
          },
          {
            fromStatus: 'saved',
            toStatus: 'applied',
            changedAt: '2026-04-15T10:00:00.000Z',
            note: null,
          },
        ],
      });

      const res = await app.request('/api/applications/01HXTEST000000000000000001/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'applied', version: 1 }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.application.status).toBe('applied');
      expect(body.statusHistory).toHaveLength(2);
    });

    it('returns 400 for invalid transition', async () => {
      vi.mocked(appService.updateApplicationStatus).mockRejectedValue(
        new InvalidTransitionError('saved', 'offer', ['applied', 'withdrawn'])
      );

      const res = await app.request('/api/applications/01HXTEST000000000000000001/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'offer', version: 1 }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('returns 400 for missing version', async () => {
      const res = await app.request('/api/applications/01HXTEST000000000000000001/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'applied' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(400);
    });
  });
});
