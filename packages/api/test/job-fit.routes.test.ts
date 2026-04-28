import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/job-fit.service.js', () => ({
  analyzeJobFit: vi.fn(),
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

import * as jobFitService from '../src/services/job-fit.service.js';
import { JobFitInputError, RateLimitError } from '../src/types/index.js';

const mockAnalysisResponse = {
  recommendation: 'moderate_fit' as const,
  summary: 'You match 4 of 6 required skills.',
  confidence: 'high' as const,
  parsedJd: {
    roleTitle: 'Senior Software Engineer',
    seniority: 'senior' as const,
    seniorityConfidence: 'high' as const,
    requiredStack: ['typescript', 'react', 'postgresql', 'aws'],
    niceToHaveStack: ['graphql'],
    industries: [],
    teamScope: null,
    location: 'Remote (US)',
    compensation: '$150k-180k',
  },
  strongMatches: [
    {
      type: 'tech_stack' as const,
      catalogEntry: 'typescript',
      jdRequirement: 'typescript',
      matchType: 'exact' as const,
      isRequired: true,
    },
  ],
  partialMatches: [],
  gaps: [
    {
      type: 'tech_stack' as const,
      jdRequirement: 'aws',
      isRequired: true,
      severity: 'critical' as const,
    },
  ],
  recommendedStarEntries: [],
  catalogEmpty: false,
  analysisTimestamp: '2026-04-25T10:30:00.000Z',
};

describe('POST /api/catalog/job-fit/analyze', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp({ logger: false });
    vi.clearAllMocks();
  });

  it('returns analysis for valid text input', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: mockAnalysisResponse,
      rateLimitHeaders: { remaining: 29, reset: 1714045860 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: {
        jobDescriptionText:
          'Senior Software Engineer\n\nRequirements:\n- TypeScript\n- React\n- PostgreSQL\n- AWS cloud experience required\n',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe('moderate_fit');
    expect(body.parsedJd.seniority).toBe('senior');
    expect(res.headers['x-ratelimit-remaining']).toBe('29');
    expect(res.headers['x-ratelimit-reset']).toBe('1714045860');
  });

  it('returns analysis for valid URL input', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: { ...mockAnalysisResponse, recommendation: 'strong_fit' },
      rateLimitHeaders: { remaining: 9, reset: 1714045860 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: { jobDescriptionUrl: 'https://boards.greenhouse.io/acme/jobs/12345' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recommendation).toBe('strong_fit');
  });

  it('returns 400 for missing input (caught at route validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for both inputs provided (caught at route validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: {
        jobDescriptionText:
          'Some job description text that is long enough to pass validation for minimum length requirements',
        jobDescriptionUrl: 'https://example.com/job',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for text too short (caught at route validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: { jobDescriptionText: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for invalid URL (caught at route validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: { jobDescriptionUrl: 'not-a-url' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns 429 when rate limit exceeded', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockRejectedValue(new RateLimitError(1714045860));

    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: {
        jobDescriptionText:
          'Senior Software Engineer role requiring TypeScript, React, and PostgreSQL experience.',
      },
    });

    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('returns catalogEmpty response when catalog has no data', async () => {
    const emptyResponse = {
      recommendation: null,
      summary:
        'Your catalog is empty. Upload a resume or add application history to enable fit analysis.',
      confidence: 'high' as const,
      parsedJd: {
        roleTitle: 'Senior Software Engineer',
        seniority: 'senior' as const,
        seniorityConfidence: 'high' as const,
        requiredStack: ['typescript'],
        niceToHaveStack: [],
        industries: [],
        teamScope: null,
        location: null,
        compensation: null,
      },
      strongMatches: [],
      partialMatches: [],
      gaps: [],
      recommendedStarEntries: [],
      catalogEmpty: true,
      analysisTimestamp: '2026-04-25T10:30:00.000Z',
    };

    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: emptyResponse,
      rateLimitHeaders: { remaining: 29, reset: 1714045860 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: {
        jobDescriptionText:
          'Senior Software Engineer role requiring TypeScript and React experience.',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.catalogEmpty).toBe(true);
    expect(body.recommendation).toBeNull();
  });

  it('calls analyzeJobFit with the parsed body and client IP', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: mockAnalysisResponse,
      rateLimitHeaders: { remaining: 29, reset: 1714045860 },
    });

    await app.inject({
      method: 'POST',
      url: '/api/catalog/job-fit/analyze',
      payload: {
        jobDescriptionText: 'Senior TypeScript Engineer with React and AWS skills required.',
      },
    });

    expect(vi.mocked(jobFitService.analyzeJobFit)).toHaveBeenCalledWith(
      { jobDescriptionText: 'Senior TypeScript Engineer with React and AWS skills required.' },
      expect.any(String)
    );
  });
});
