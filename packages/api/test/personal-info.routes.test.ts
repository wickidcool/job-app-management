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
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '+1-555-555-5555',
  addressLine1: '123 Main St',
  addressLine2: 'Apt 4B',
  city: 'Anytown',
  state: 'CA',
  postalCode: '12345',
  country: 'USA',
  linkedinUrl: 'https://linkedin.com/in/janedoe',
  githubUrl: 'https://github.com/janedoe',
  portfolioUrl: 'https://janedoe.dev',
  websiteUrl: 'https://janedoe.com',
  professionalSummary: 'Software engineer with 10 years of experience',
  headline: 'Senior Software Engineer',
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
      vi.mocked(personalInfoService.getPersonalInfo).mockResolvedValue({
        personalInfo: mockPersonalInfo,
        isComplete: true,
        completionPercentage: 100,
      });

      const res = await app.request('/api/personal-info', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.firstName).toBe('Jane');
      expect(body.personalInfo.lastName).toBe('Doe');
      expect(body.personalInfo.email).toBe('jane@example.com');
    });

    it('returns default object when no personal info exists', async () => {
      const defaultInfo = {
        id: '01HXTEST000000000000000002',
        userId: null,
        firstName: '',
        lastName: '',
        email: '',
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        linkedinUrl: null,
        githubUrl: null,
        portfolioUrl: null,
        websiteUrl: null,
        professionalSummary: null,
        headline: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      };
      vi.mocked(personalInfoService.getPersonalInfo).mockResolvedValue({
        personalInfo: defaultInfo,
        isComplete: false,
        completionPercentage: 0,
      });

      const res = await app.request('/api/personal-info', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.firstName).toBe('');
      expect(body.isComplete).toBe(false);
    });
  });

  describe('PATCH /api/personal-info', () => {
    it('creates personal info on first call', async () => {
      vi.mocked(personalInfoService.upsertPersonalInfo).mockResolvedValue({
        personalInfo: mockPersonalInfo,
        isComplete: false,
        completionPercentage: 20,
      });

      const res = await app.request('/api/personal-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.firstName).toBe('Jane');
      expect(body.personalInfo.lastName).toBe('Doe');
    });

    it('updates personal info with all fields', async () => {
      const updated = { ...mockPersonalInfo, firstName: 'Janet', version: 2 };
      vi.mocked(personalInfoService.upsertPersonalInfo).mockResolvedValue({
        personalInfo: updated,
        isComplete: true,
        completionPercentage: 100,
      });

      const res = await app.request('/api/personal-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Janet',
          lastName: 'Doe',
          email: 'jane@example.com',
          phone: '+1-555-555-5555',
          addressLine1: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          postalCode: '12345',
          country: 'USA',
          linkedinUrl: 'https://linkedin.com/in/janedoe',
          githubUrl: 'https://github.com/janedoe',
          portfolioUrl: 'https://janedoe.dev',
          websiteUrl: 'https://janedoe.com',
          professionalSummary: 'Software engineer',
          headline: 'Senior Engineer',
          version: 1,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.firstName).toBe('Janet');
      expect(personalInfoService.upsertPersonalInfo).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Janet', version: 1 }),
        undefined
      );
    });

    it('returns 400 for invalid email', async () => {
      const res = await app.request('/api/personal-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-a-valid-email' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_EMAIL');
    });

    it('returns 400 for invalid URL fields', async () => {
      const res = await app.request('/api/personal-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedinUrl: 'not-a-url' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_URL');
    });

    it('returns 409 on version conflict', async () => {
      vi.mocked(personalInfoService.upsertPersonalInfo).mockRejectedValue(
        new VersionConflictError()
      );

      const res = await app.request('/api/personal-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: 'Jane', version: 99 }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('VERSION_CONFLICT');
    });

    it('accepts null values to clear fields', async () => {
      const cleared = { ...mockPersonalInfo, phone: null, linkedinUrl: null };
      vi.mocked(personalInfoService.upsertPersonalInfo).mockResolvedValue({
        personalInfo: cleared,
        isComplete: true,
        completionPercentage: 85,
      });

      const res = await app.request('/api/personal-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: null, linkedinUrl: null }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.personalInfo.phone).toBeNull();
      expect(body.personalInfo.linkedinUrl).toBeNull();
    });
  });
});
