import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/personal-info.service.js', () => ({
  getPersonalInfo: vi.fn(),
  upsertPersonalInfo: vi.fn(),
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

import * as personalInfoService from '../src/services/personal-info.service.js';
import { VersionConflictError } from '../src/types/index.js';

const mockPersonalInfo = {
  id: '01HXTEST000000000000000001',
  userId: null,
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  linkedinUrl: 'https://linkedin.com/in/janedoe',
  githubUrl: 'https://github.com/janedoe',
  homeAddress: '123 Main St, Anytown, USA',
  phoneNumber: '+1-555-555-5555',
  projectsWebsite: 'https://janedoe.dev',
  publishingPlatforms: ['https://janedoe.substack.com'],
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  version: 1,
};

describe('Personal Info Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  describe('GET /api/personal-info', () => {
    it('returns personal info when it exists', async () => {
      vi.mocked(personalInfoService.getPersonalInfo).mockResolvedValue(mockPersonalInfo);

      const res = await app.request('/api/personal-info', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.fullName).toBe('Jane Doe');
      expect(body.personalInfo.email).toBe('jane@example.com');
    });

    it('returns null when no personal info exists', async () => {
      vi.mocked(personalInfoService.getPersonalInfo).mockResolvedValue(null);

      const res = await app.request('/api/personal-info', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo).toBeNull();
    });
  });

  describe('PUT /api/personal-info', () => {
    it('creates personal info on first call', async () => {
      vi.mocked(personalInfoService.upsertPersonalInfo).mockResolvedValue(mockPersonalInfo);

      const res = await app.request('/api/personal-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Jane Doe',
          email: 'jane@example.com',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.fullName).toBe('Jane Doe');
    });

    it('updates personal info with all fields', async () => {
      const updated = { ...mockPersonalInfo, fullName: 'Jane Smith', version: 2 };
      vi.mocked(personalInfoService.upsertPersonalInfo).mockResolvedValue(updated);

      const res = await app.request('/api/personal-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Jane Smith',
          email: 'jane@example.com',
          linkedinUrl: 'https://linkedin.com/in/janedoe',
          githubUrl: 'https://github.com/janedoe',
          homeAddress: '123 Main St, Anytown, USA',
          phoneNumber: '+1-555-555-5555',
          projectsWebsite: 'https://janedoe.dev',
          publishingPlatforms: ['https://janedoe.substack.com'],
          version: 1,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.fullName).toBe('Jane Smith');
      expect(personalInfoService.upsertPersonalInfo).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: 'Jane Smith', version: 1 }),
        undefined
      );
    });

    it('returns 400 for invalid email', async () => {
      const res = await app.request('/api/personal-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-a-valid-email' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid URL fields', async () => {
      const res = await app.request('/api/personal-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedinUrl: 'not-a-url' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 on version conflict', async () => {
      vi.mocked(personalInfoService.upsertPersonalInfo).mockRejectedValue(
        new VersionConflictError()
      );

      const res = await app.request('/api/personal-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: 'Jane Doe', version: 99 }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('VERSION_CONFLICT');
    });

    it('accepts null values to clear fields', async () => {
      const cleared = { ...mockPersonalInfo, fullName: null, linkedinUrl: null };
      vi.mocked(personalInfoService.upsertPersonalInfo).mockResolvedValue(cleared);

      const res = await app.request('/api/personal-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: null, linkedinUrl: null }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.fullName).toBeNull();
    });
  });
});
