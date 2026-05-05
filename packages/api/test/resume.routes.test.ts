import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/resume.service.js', () => ({
  uploadResume: vi.fn(),
  listResumeExports: vi.fn(),
  getResumeExport: vi.fn(),
}));

// Prevent other service mocks from leaking into app startup
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

import * as resumeService from '../src/services/resume.service.js';
import { NotFoundError } from '../src/types/index.js';

const mockResume = {
  id: '01HXTEST000000000000000001',
  fileName: 'resume.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  uploadedAt: '2026-04-17T10:00:00.000Z',
  version: 1,
};

const mockExport = {
  id: '01HXTEST000000000000000002',
  resumeId: '01HXTEST000000000000000001',
  exportType: 'star_markdown',
  filePath: '/data/resume-exports/01HXTEST000000000000000002_star.md',
  generatedAt: '2026-04-17T10:00:01.000Z',
  metadata: { sections: [{ heading: 'Experience', bulletCount: 5 }], charCount: 2000 },
};

describe('Resume Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  describe('POST /api/resumes/upload', () => {
    it('returns 201 with resume and export on successful upload', async () => {
      vi.mocked(resumeService.uploadResume).mockResolvedValue({
        resume: mockResume,
        export: mockExport,
      });

      const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content');
      const form = new FormData();
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      form.append('file', blob, 'resume.pdf');

      const res = await app.request('/api/resumes/upload', { method: 'POST', body: form })

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.resume).toBeDefined();
      expect(body.export).toBeDefined();
    });

    it('returns 415 for unsupported file type', async () => {
      const form = new FormData();
      const blob = new Blob(['hello'], { type: 'text/plain' });
      form.append('file', blob, 'resume.txt');
      const res = await app.request('/api/resumes/upload', { method: 'POST', body: form })

      expect(res.status).toBe(415);
    });

    it('returns 400 when no file provided', async () => {
      const res = await app.request('/api/resumes/upload', { method: 'POST' })

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/resumes/:id/exports', () => {
    it('returns list of exports for a resume', async () => {
      vi.mocked(resumeService.listResumeExports).mockResolvedValue([mockExport]);

      const res = await app.request(`/api/resumes/${mockResume.id}/exports`, { method: 'GET' })

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.exports).toHaveLength(1);
      expect(body.exports[0].resumeId).toBe(mockResume.id);
    });

    it('returns 404 when resume not found', async () => {
      vi.mocked(resumeService.listResumeExports).mockRejectedValue(new NotFoundError('Resume'));

      const res = await app.request('/api/resumes/nonexistent/exports', { method: 'GET' })

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/resumes/:id/exports/:exportId', () => {
    it('returns a single export', async () => {
      vi.mocked(resumeService.getResumeExport).mockResolvedValue(mockExport);

      const res = await app.request(`/api/resumes/${mockResume.id}/exports/${mockExport.id}`, { method: 'GET' })

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(mockExport.id);
      expect(body.exportType).toBe('star_markdown');
    });

    it('returns 404 when export not found', async () => {
      vi.mocked(resumeService.getResumeExport).mockRejectedValue(
        new NotFoundError('Resume export')
      );

      const res = await app.request(`/api/resumes/${mockResume.id}/exports/nonexistent`, { method: 'GET' })

      expect(res.status).toBe(404);
    });
  });
});
