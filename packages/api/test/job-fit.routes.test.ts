import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/job-fit.service.js', () => ({
  analyzeJobFit: vi.fn(),
  listJobFitAnalyses: vi.fn(),
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
  // WIC-1652: the analysis is persisted, so it has an identity and an owner.
  id: '01JQ0000000000000000000001',
  applicationId: 'app-1',
  fitScore: 62,
  recommendation: 'moderate_fit' as const,
  summary: 'You match 4 of 6 required skills. This role is within reach.',
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
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns analysis for valid text input', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: mockAnalysisResponse,
      rateLimitHeaders: { remaining: 29, reset: 1714045860 },
    });

    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({
        jobDescriptionText:
          'Senior Software Engineer\n\nRequirements:\n- TypeScript\n- React\n- PostgreSQL\n- AWS cloud experience required\n',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendation).toBe('moderate_fit');
    expect(body.parsedJd.seniority).toBe('senior');
    // Before WIC-1652 the response was unaddressable: no id reached the client,
    // so `jobFitAnalysisId` on the generation endpoints was unpopulatable.
    expect(body.id).toBe('01JQ0000000000000000000001');
    expect(body.applicationId).toBe('app-1');
    expect(body.fitScore).toBe(62);
    expect(res.headers.get('x-ratelimit-remaining')).toBe('29');
    expect(res.headers.get('x-ratelimit-reset')).toBe('1714045860');
  });

  it('returns analysis for valid URL input', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: { ...mockAnalysisResponse, recommendation: 'strong_fit' },
      rateLimitHeaders: { remaining: 9, reset: 1714045860 },
    });

    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({ jobDescriptionUrl: 'https://boards.greenhouse.io/acme/jobs/12345' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect((await res.json()).recommendation).toBe('strong_fit');
  });

  it('returns 400 for missing input (caught at route validation)', async () => {
    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for both inputs provided (caught at route validation)', async () => {
    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({
        jobDescriptionText:
          'Some job description text that is long enough to pass validation for minimum length requirements',
        jobDescriptionUrl: 'https://example.com/job',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for text too short (caught at route validation)', async () => {
    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({ jobDescriptionText: 'short' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for invalid URL (caught at route validation)', async () => {
    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({ jobDescriptionUrl: 'not-a-url' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('returns 429 when rate limit exceeded', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockRejectedValue(new RateLimitError(1714045860));

    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({
        jobDescriptionText:
          'Senior Software Engineer role requiring TypeScript, React, and PostgreSQL experience.',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('RATE_LIMIT_EXCEEDED');
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

    const res = await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({
        jobDescriptionText:
          'Senior Software Engineer role requiring TypeScript and React experience.',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.catalogEmpty).toBe(true);
    expect(body.recommendation).toBeNull();
  });

  it('calls analyzeJobFit with the parsed body and client IP', async () => {
    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: mockAnalysisResponse,
      rateLimitHeaders: { remaining: 29, reset: 1714045860 },
    });

    await app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify({
        jobDescriptionText: 'Senior TypeScript Engineer with React and AWS skills required.',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(vi.mocked(jobFitService.analyzeJobFit)).toHaveBeenCalledWith(
      { jobDescriptionText: 'Senior TypeScript Engineer with React and AWS skills required.' },
      expect.any(String),
      // The caller identity, third since WIC-1652: the analysis is now written
      // down, so it has an owner. `undefined` here because this suite runs with
      // auth bypassed, which is the same value an unauthenticated request
      // produces — the identity is passed through, not defaulted.
      undefined
    );
  });
});

describe('POST /api/catalog/job-fit/analyze — applicationId (WIC-1652)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(jobFitService.analyzeJobFit).mockResolvedValue({
      response: mockAnalysisResponse,
      rateLimitHeaders: { remaining: 29, reset: 1714045860 },
    });
  });

  const analyze = (body: unknown) =>
    app.request('/api/catalog/job-fit/analyze', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

  const JD = 'Senior Software Engineer role requiring TypeScript, React, and PostgreSQL.';

  it('passes applicationId through to the service', async () => {
    const res = await analyze({ jobDescriptionText: JD, applicationId: 'app-1' });

    expect(res.status).toBe(200);
    expect(vi.mocked(jobFitService.analyzeJobFit)).toHaveBeenCalledWith(
      { jobDescriptionText: JD, applicationId: 'app-1' },
      expect.any(String),
      undefined
    );
  });

  it('rejects an empty applicationId at the boundary', async () => {
    // `z.string().optional()` admits `''`, and a truthiness test downstream
    // would read it as "not supplied" — the WIC-1818 trap. `.min(1)` makes it a
    // 400 here instead of an id the service has to disambiguate.
    const res = await analyze({ jobDescriptionText: JD, applicationId: '' });

    expect(res.status).toBe(400);
    expect(vi.mocked(jobFitService.analyzeJobFit)).not.toHaveBeenCalled();
  });

  it('leaves applicationId optional', async () => {
    const res = await analyze({ jobDescriptionText: JD });
    expect(res.status).toBe(200);
  });

  it('surfaces an unresolvable applicationId as 404', async () => {
    const { AppError } = await import('../src/types/index.js');
    vi.mocked(jobFitService.analyzeJobFit).mockRejectedValue(
      new AppError('APPLICATION_NOT_FOUND', 'Application not found', undefined, 404)
    );

    const res = await analyze({ jobDescriptionText: JD, applicationId: 'nope' });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('APPLICATION_NOT_FOUND');
  });
});

describe('GET /api/catalog/job-fit/analyses (WIC-1652)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  const summary = {
    id: '01JQ0000000000000000000001',
    applicationId: 'app-1',
    recommendation: 'moderate_fit' as const,
    fitScore: 62,
    summary: 'You match 4 of 6 required skills.',
    confidence: 'high' as const,
    catalogEmpty: false,
    analyzedAt: '2026-08-30T00:00:00.000Z',
  };

  it('returns the stored analyses for an application', async () => {
    // The read half. Without it an analysis is stored but unfindable, so
    // `ApplicationDetail` still cannot tell whether one exists.
    vi.mocked(jobFitService.listJobFitAnalyses).mockResolvedValue({ analyses: [summary] });

    const res = await app.request('/api/catalog/job-fit/analyses?applicationId=app-1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analyses).toHaveLength(1);
    expect(body.analyses[0]).toMatchObject({ id: summary.id, fitScore: 62 });
    expect(vi.mocked(jobFitService.listJobFitAnalyses)).toHaveBeenCalledWith(
      { applicationId: 'app-1' },
      undefined
    );
  });

  it('coerces limit and rejects one out of range', async () => {
    vi.mocked(jobFitService.listJobFitAnalyses).mockResolvedValue({ analyses: [] });

    await app.request('/api/catalog/job-fit/analyses?limit=5');
    expect(vi.mocked(jobFitService.listJobFitAnalyses)).toHaveBeenCalledWith(
      { limit: 5 },
      undefined
    );

    const res = await app.request('/api/catalog/job-fit/analyses?limit=500');
    expect(res.status).toBe(400);
  });

  it('works with no filter at all', async () => {
    vi.mocked(jobFitService.listJobFitAnalyses).mockResolvedValue({ analyses: [] });

    const res = await app.request('/api/catalog/job-fit/analyses');

    expect(res.status).toBe(200);
    expect(vi.mocked(jobFitService.listJobFitAnalyses)).toHaveBeenCalledWith({}, undefined);
  });
});
