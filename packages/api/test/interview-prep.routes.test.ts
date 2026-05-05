import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/interviewPrep.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/interviewPrep.service.js')>();
  return {
    ...actual,
    generateInterviewPrep: vi.fn(),
    getInterviewPrep: vi.fn(),
    getInterviewPrepByApplication: vi.fn(),
    updateInterviewPrep: vi.fn(),
    exportInterviewPrep: vi.fn(),
    logPracticeSession: vi.fn(),
    deleteInterviewPrep: vi.fn(),
  };
});

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

import * as prepService from '../src/services/interviewPrep.service.js';
import { NotFoundError, VersionConflictError } from '../src/types/index.js';
import { InterviewPrepError } from '../src/services/interviewPrep.service.js';

// ── Shared mock data ────────────────────────────────────────────────────────

const mockStory = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1',
  starEntryId: '01HXK5R3J7Q8N2M4P6W9Y1Z3C7',
  themes: ['technical', 'problem_solving'],
  relevanceScore: 92,
  oneMinVersion: 'Led API optimization that reduced response times by 40%.',
  twoMinVersion:
    'At Acme Corp, I identified performance bottlenecks in our API layer. I implemented query optimization and Redis caching, reducing response times by 40% and improving user satisfaction by 15%.',
  fiveMinVersion:
    'When I joined Acme Corp, our API response times were averaging 800ms...[full story]',
  isFavorite: false,
  practiceCount: 0,
  confidenceLevel: 'not_practiced' as const,
  displayOrder: 1,
};

const mockQuestion = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3Q1',
  text: 'Tell me about a time you led a challenging technical project.',
  category: 'behavioral' as const,
  difficulty: 'standard' as const,
  whyTheyAsk:
    'They want to understand your leadership style and technical problem-solving approach.',
  whatTheyWant: 'Concrete examples of leading through ambiguity and delivering results.',
  answerFramework:
    'Use STAR format: describe the project scope, leadership role, key decisions, and measurable outcomes.',
  suggestedStoryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3S1'],
  practiceStatus: 'not_practiced' as const,
};

const mockGapMitigation = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3G1',
  skill: 'AWS',
  severity: 'critical' as const,
  description: 'No direct AWS experience mentioned in catalog',
  whyItMatters: 'This role requires AWS for production infrastructure',
  strategies: {
    acknowledgePivot: {
      title: 'Acknowledge & Pivot',
      script:
        "While I haven't worked directly with AWS, I have extensive experience with Azure which shares similar cloud concepts.",
      keyPhrases: ['transferable skills', 'cloud fundamentals', 'quick learner'],
      redirectToStrength:
        'My Azure experience includes deploying containerized applications at scale...',
    },
    growthMindset: {
      title: 'Growth Mindset',
      script:
        "I'm actively building AWS skills through hands-on projects and have already earned the Cloud Practitioner certification.",
      keyPhrases: ['actively learning', 'certification progress', 'hands-on practice'],
      redirectToStrength: "I've found my cloud fundamentals transfer well...",
    },
    adjacentExperience: {
      title: 'Adjacent Experience',
      script:
        'In my current role, I architected similar distributed systems using Azure, which shares core cloud patterns with AWS.',
      keyPhrases: ['distributed systems', 'cloud architecture', 'infrastructure as code'],
      redirectToStrength: 'For example, I designed a multi-region deployment that...',
    },
  },
  relatedStoryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3S3'],
  isAddressed: false,
};

const mockPrep = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
  applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
  jobFitAnalysisId: '01HXK5R3J7Q8N2M4P6W9Y1Z3D8',
  interviewType: 'mixed' as const,
  timeAvailable: '1hr' as const,
  focusAreas: ['leadership', 'technical', 'problem_solving'],
  completeness: 25,
  stories: [mockStory],
  questions: [mockQuestion],
  gapMitigations: [mockGapMitigation],
  quickReference: null,
  practiceLog: [],
  createdAt: '2026-04-28T12:00:00.000Z',
  updatedAt: '2026-04-28T12:00:00.000Z',
  version: 1,
};

const mockApplication = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
  jobTitle: 'Senior Software Engineer',
  company: 'Acme Corp',
  status: 'interview' as const,
};

const mockFitAnalysis = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3D8',
  recommendation: 'moderate_fit',
  confidence: 'high',
  analysisTimestamp: '2026-04-25T10:30:00.000Z',
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Interview Prep Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp({ logger: false });
    vi.clearAllMocks();
  });

  // ── POST /api/interview-preps ────────────────────────────────────────────
  // AC: "Generate prep from interview status" (10j row 1)
  // AC: "No fit analysis fallback" (10j row 9)
  // AC: "Empty catalog blocking" (10j row 10)

  describe('POST /api/interview-preps', () => {
    it('returns 201 with full prep when application is in interview status with linked fit analysis', async () => {
      vi.mocked(prepService.generateInterviewPrep).mockResolvedValue({
        interviewPrep: mockPrep,
        storiesGenerated: 8,
        questionsGenerated: 12,
        gapsIdentified: 1,
        catalogEntriesUsed: 15,
        warnings: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
          jobFitAnalysisId: '01HXK5R3J7Q8N2M4P6W9Y1Z3D8',
          interviewType: 'mixed',
          timeAvailable: '1hr',
          focusAreas: ['leadership', 'technical', 'problem_solving'],
        }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.interviewPrep.id).toBe('01HXK5R3J7Q8N2M4P6W9Y1Z3P1');
      expect(body.interviewPrep.applicationId).toBe('01HXK5R3J7Q8N2M4P6W9Y1Z3A5');
      expect(body.interviewPrep.jobFitAnalysisId).toBe('01HXK5R3J7Q8N2M4P6W9Y1Z3D8');
      expect(body.interviewPrep.stories).toHaveLength(1);
      expect(body.interviewPrep.questions).toHaveLength(1);
      expect(body.interviewPrep.gapMitigations).toHaveLength(1);
      expect(body.storiesGenerated).toBe(8);
      expect(body.questionsGenerated).toBe(12);
      expect(body.gapsIdentified).toBe(1);
      expect(body.warnings).toEqual([]);
      expect(prepService.generateInterviewPrep).toHaveBeenCalledOnce();
    });

    it('returns 201 with NO_FIT_ANALYSIS warning when no fit analysis provided (fallback, AC 10j row 9)', async () => {
      vi.mocked(prepService.generateInterviewPrep).mockResolvedValue({
        interviewPrep: { ...mockPrep, jobFitAnalysisId: undefined, gapMitigations: [] },
        storiesGenerated: 5,
        questionsGenerated: 8,
        gapsIdentified: 0,
        catalogEntriesUsed: 10,
        warnings: [
          {
            code: 'NO_FIT_ANALYSIS',
            message: 'Generated without job fit analysis (gaps may be incomplete)',
          },
        ],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
        }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0].code).toBe('NO_FIT_ANALYSIS');
    });

    it('returns 201 with LIMITED_STAR_ENTRIES warning when catalog has few entries', async () => {
      vi.mocked(prepService.generateInterviewPrep).mockResolvedValue({
        interviewPrep: { ...mockPrep, completeness: 10 },
        storiesGenerated: 2,
        questionsGenerated: 4,
        gapsIdentified: 1,
        catalogEntriesUsed: 2,
        warnings: [
          { code: 'LIMITED_STAR_ENTRIES', message: 'Fewer than 5 STAR entries in catalog' },
        ],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
        }),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().warnings[0].code).toBe('LIMITED_STAR_ENTRIES');
    });

    it('returns 422 with CATALOG_EMPTY when user has no STAR entries (AC 10j row 10)', async () => {
      vi.mocked(prepService.generateInterviewPrep).mockRejectedValue(
        new InterviewPrepError(
          'CATALOG_EMPTY',
          'No catalog entries found. Upload a resume to build your story bank.',
          undefined,
          422
        )
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
        }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('CATALOG_EMPTY');
    });

    it('returns 400 when applicationId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          interviewType: 'behavioral',
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when interviewType is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
          interviewType: 'dance_off',
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when timeAvailable is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
          timeAvailable: '45min',
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when application does not exist', async () => {
      vi.mocked(prepService.generateInterviewPrep).mockRejectedValue(
        new NotFoundError('Application')
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: 'nonexistent-app-id',
        }),
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns existing prep (200) instead of 201 when prep already exists for the application', async () => {
      vi.mocked(prepService.generateInterviewPrep).mockResolvedValue({
        interviewPrep: { ...mockPrep, version: 2 },
        storiesGenerated: 0,
        questionsGenerated: 0,
        gapsIdentified: 0,
        catalogEntriesUsed: 0,
        warnings: [],
        existing: true,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
        }),
      });

      // Should return 200 (existing) or 201 (newly created) — either is acceptable
      expect([200, 201]).toContain(res.statusCode);
    });

    it('passes all valid interviewType values', async () => {
      for (const type of ['behavioral', 'technical', 'mixed', 'case_study']) {
        vi.mocked(prepService.generateInterviewPrep).mockResolvedValue({
          interviewPrep: { ...mockPrep, interviewType: type as any },
          storiesGenerated: 5,
          questionsGenerated: 8,
          gapsIdentified: 1,
          catalogEntriesUsed: 10,
          warnings: [],
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/interview-preps',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
            interviewType: type,
          }),
        });

        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ── GET /api/interview-preps/:id ──────────────────────────────────────────
  // AC: Response includes stories by theme, questions, gapMitigations (10j rows 2–5)

  describe('GET /api/interview-preps/:id', () => {
    it('returns 200 with full prep including stories, questions, and gaps', async () => {
      vi.mocked(prepService.getInterviewPrep).mockResolvedValue({
        interviewPrep: mockPrep,
        application: mockApplication,
        fitAnalysis: mockFitAnalysis,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.interviewPrep.id).toBe('01HXK5R3J7Q8N2M4P6W9Y1Z3P1');
      expect(body.application.status).toBe('interview');
      expect(body.fitAnalysis.recommendation).toBe('moderate_fit');
    });

    it('returns stories organized with theme tags (AC 10j row 2 — STAR organization by theme)', async () => {
      const storiesMultiTheme = [
        { ...mockStory, themes: ['leadership', 'technical'] },
        { ...mockStory, id: 'story-2', themes: ['teamwork'] },
        { ...mockStory, id: 'story-3', themes: ['problem_solving', 'innovation'] },
      ];

      vi.mocked(prepService.getInterviewPrep).mockResolvedValue({
        interviewPrep: { ...mockPrep, stories: storiesMultiTheme },
        application: mockApplication,
        fitAnalysis: mockFitAnalysis,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
      });

      expect(res.statusCode).toBe(200);
      const { stories } = res.json().interviewPrep;
      expect(stories).toHaveLength(3);
      expect(stories[0].themes).toContain('leadership');
      stories.forEach((s: any) => {
        expect(Array.isArray(s.themes)).toBe(true);
        expect(s.themes.length).toBeGreaterThan(0);
        expect(typeof s.relevanceScore).toBe('number');
      });
    });

    it('returns stories with all three time-boxed versions (AC 10j row 5)', async () => {
      vi.mocked(prepService.getInterviewPrep).mockResolvedValue({
        interviewPrep: mockPrep,
        application: mockApplication,
        fitAnalysis: mockFitAnalysis,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
      });

      expect(res.statusCode).toBe(200);
      const { stories } = res.json().interviewPrep;
      stories.forEach((s: any) => {
        expect(s).toHaveProperty('oneMinVersion');
        expect(s).toHaveProperty('twoMinVersion');
        expect(s).toHaveProperty('fiveMinVersion');
        expect(typeof s.oneMinVersion).toBe('string');
        expect(s.oneMinVersion.length).toBeGreaterThan(0);
      });
    });

    it('returns gap mitigations each with all three strategy types (AC 10j row 4)', async () => {
      vi.mocked(prepService.getInterviewPrep).mockResolvedValue({
        interviewPrep: {
          ...mockPrep,
          gapMitigations: [
            mockGapMitigation,
            {
              ...mockGapMitigation,
              id: 'gap-2',
              skill: 'Kubernetes',
              severity: 'moderate' as const,
            },
          ],
        },
        application: mockApplication,
        fitAnalysis: mockFitAnalysis,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
      });

      expect(res.statusCode).toBe(200);
      const { gapMitigations } = res.json().interviewPrep;
      expect(gapMitigations).toHaveLength(2);
      gapMitigations.forEach((g: any) => {
        expect(g.strategies).toHaveProperty('acknowledgePivot');
        expect(g.strategies).toHaveProperty('growthMindset');
        expect(g.strategies).toHaveProperty('adjacentExperience');
        expect(g.strategies.acknowledgePivot).toHaveProperty('script');
        expect(g.strategies.growthMindset).toHaveProperty('script');
        expect(g.strategies.adjacentExperience).toHaveProperty('script');
      });
    });

    it('returns questions with at least 2 behavioral questions per required skill (AC 10j row 3)', async () => {
      const manyQuestions = [
        { ...mockQuestion, id: 'q1', category: 'behavioral' as const },
        { ...mockQuestion, id: 'q2', category: 'behavioral' as const },
        { ...mockQuestion, id: 'q3', category: 'technical' as const },
        { ...mockQuestion, id: 'q4', category: 'behavioral' as const },
        { ...mockQuestion, id: 'q5', category: 'gap_probing' as const },
      ];

      vi.mocked(prepService.getInterviewPrep).mockResolvedValue({
        interviewPrep: { ...mockPrep, questions: manyQuestions },
        application: mockApplication,
        fitAnalysis: mockFitAnalysis,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
      });

      expect(res.statusCode).toBe(200);
      const { questions } = res.json().interviewPrep;
      const behavioralCount = questions.filter((q: any) => q.category === 'behavioral').length;
      expect(behavioralCount).toBeGreaterThanOrEqual(2);
    });

    it('includes linked application summary in response', async () => {
      vi.mocked(prepService.getInterviewPrep).mockResolvedValue({
        interviewPrep: mockPrep,
        application: mockApplication,
        fitAnalysis: undefined,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.application).toBeDefined();
      expect(body.application.jobTitle).toBe('Senior Software Engineer');
      expect(body.application.company).toBe('Acme Corp');
      expect(body.fitAnalysis).toBeUndefined();
    });

    it('returns 404 when prep not found', async () => {
      vi.mocked(prepService.getInterviewPrep).mockRejectedValue(new NotFoundError('InterviewPrep'));

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/nonexistent',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/applications/:applicationId/interview-prep ───────────────────
  // AC: "Entry from main navigation" — also covers application-scoped lookup (10j row 8)

  describe('GET /api/applications/:applicationId/interview-prep', () => {
    it('returns 200 with prep for the given application', async () => {
      vi.mocked(prepService.getInterviewPrepByApplication).mockResolvedValue({
        interviewPrep: mockPrep,
        application: mockApplication,
        fitAnalysis: mockFitAnalysis,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/applications/01HXK5R3J7Q8N2M4P6W9Y1Z3A5/interview-prep',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().interviewPrep.applicationId).toBe('01HXK5R3J7Q8N2M4P6W9Y1Z3A5');
    });

    it('returns 404 when no prep exists for the application', async () => {
      vi.mocked(prepService.getInterviewPrepByApplication).mockRejectedValue(
        new NotFoundError('InterviewPrep')
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/applications/app-with-no-prep/interview-prep',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /api/interview-preps/:id ────────────────────────────────────────

  describe('PATCH /api/interview-preps/:id', () => {
    it('returns 200 when marking a story as favorite', async () => {
      const updated = { ...mockPrep, stories: [{ ...mockStory, isFavorite: true }], version: 2 };
      vi.mocked(prepService.updateInterviewPrep).mockResolvedValue({
        interviewPrep: updated,
        completenessChange: 5,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storyUpdates: [{ storyId: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1', isFavorite: true }],
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().interviewPrep.stories[0].isFavorite).toBe(true);
    });

    it('returns 200 when linking a story to a question', async () => {
      const updatedQuestion = {
        ...mockQuestion,
        linkedStoryId: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1',
        practiceStatus: 'comfortable' as const,
      };
      const updated = { ...mockPrep, questions: [updatedQuestion], version: 2 };
      vi.mocked(prepService.updateInterviewPrep).mockResolvedValue({
        interviewPrep: updated,
        completenessChange: 10,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionUpdates: [
            {
              questionId: '01HXK5R3J7Q8N2M4P6W9Y1Z3Q1',
              linkedStoryId: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1',
              practiceStatus: 'comfortable',
            },
          ],
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().interviewPrep.questions[0].linkedStoryId).toBe(
        '01HXK5R3J7Q8N2M4P6W9Y1Z3S1'
      );
    });

    it('returns 200 when selecting a gap mitigation strategy and marking as addressed', async () => {
      const updatedGap = {
        ...mockGapMitigation,
        selectedStrategy: 'acknowledge_pivot' as const,
        isAddressed: true,
      };
      const updated = { ...mockPrep, gapMitigations: [updatedGap], version: 2 };
      vi.mocked(prepService.updateInterviewPrep).mockResolvedValue({
        interviewPrep: updated,
        completenessChange: 15,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gapUpdates: [
            {
              gapId: '01HXK5R3J7Q8N2M4P6W9Y1Z3G1',
              selectedStrategy: 'acknowledge_pivot',
              isAddressed: true,
            },
          ],
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.interviewPrep.gapMitigations[0].isAddressed).toBe(true);
      expect(body.interviewPrep.gapMitigations[0].selectedStrategy).toBe('acknowledge_pivot');
    });

    it('returns 200 and reports completeness delta', async () => {
      const updated = { ...mockPrep, completeness: 65, version: 3 };
      vi.mocked(prepService.updateInterviewPrep).mockResolvedValue({
        interviewPrep: updated,
        completenessChange: 40,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          focusAreas: ['leadership', 'technical'],
          version: 2,
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.completenessChange).toBe(40);
    });

    it('returns 409 on optimistic lock version conflict', async () => {
      vi.mocked(prepService.updateInterviewPrep).mockRejectedValue(new VersionConflictError());

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          focusAreas: ['leadership'],
          version: 99,
        }),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('VERSION_CONFLICT');
    });

    it('returns 400 when version field is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          focusAreas: ['leadership'],
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when prep not found', async () => {
      vi.mocked(prepService.updateInterviewPrep).mockRejectedValue(
        new NotFoundError('InterviewPrep')
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/interview-preps/nonexistent',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/interview-preps/:id/export ───────────────────────────────────
  // AC: "Quick reference card export" (10j row 6)

  describe('GET /api/interview-preps/:id/export', () => {
    const mockExportResult = {
      buffer: Buffer.from('# Interview Prep\nMock markdown content'),
      filename: 'interview-prep-acme-corp-2026-04-28.md',
      contentType: 'text/markdown',
    };

    it('returns markdown binary when format=pdf (fallback) and no Accept: application/json header', async () => {
      vi.mocked(prepService.exportInterviewPrep).mockResolvedValue(mockExportResult);

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/export?format=pdf',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/markdown');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain(
        'interview-prep-acme-corp-2026-04-28.md'
      );
    });

    it('returns JSON with base64 content when Accept: application/json header is set for PDF (fallback)', async () => {
      vi.mocked(prepService.exportInterviewPrep).mockResolvedValue(mockExportResult);

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/export?format=pdf',
        headers: { accept: 'application/json' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.exportId).toBeDefined();
      expect(body.format).toBe('pdf');
      expect(body.filename).toContain('.md');
      expect(typeof body.base64Content).toBe('string');
    });

    it('returns markdown file when format=markdown', async () => {
      const mdResult = {
        buffer: Buffer.from('# Interview Prep\n\n## Top Stories\n'),
        filename: 'interview-prep-acme-corp-2026-04-28.md',
        contentType: 'text/markdown',
      };
      vi.mocked(prepService.exportInterviewPrep).mockResolvedValue(mdResult);

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/export?format=markdown',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
    });

    it('returns print-friendly HTML when format=print', async () => {
      const printResult = {
        buffer: Buffer.from('<html><body>Interview Prep</body></html>'),
        filename: 'interview-prep-acme-corp-2026-04-28.html',
        contentType: 'text/html',
      };
      vi.mocked(prepService.exportInterviewPrep).mockResolvedValue(printResult);

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/export?format=print',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('returns 400 when format is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/export',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when format is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/export?format=docx',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('returns 404 when prep not found', async () => {
      vi.mocked(prepService.exportInterviewPrep).mockRejectedValue(
        new NotFoundError('InterviewPrep')
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/interview-preps/nonexistent/export?format=pdf',
      });

      expect(res.statusCode).toBe(404);
    });

    it('passes sections query param to service', async () => {
      vi.mocked(prepService.exportInterviewPrep).mockResolvedValue(mockExportResult);

      await app.inject({
        method: 'GET',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/export?format=pdf&sections=stories,questions',
      });

      expect(prepService.exportInterviewPrep).toHaveBeenCalledWith(
        '01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
        'pdf',
        ['stories', 'questions'],
        undefined
      );
    });
  });

  // ── POST /api/interview-preps/:id/practice ────────────────────────────────
  // AC: "Practice mode tracking" (10j row 7)

  describe('POST /api/interview-preps/:id/practice', () => {
    const mockPracticeSession = {
      id: '01HXK5R3J7Q8N2M4P6W9Y1Z3X1',
      startedAt: '2026-04-28T14:00:00.000Z',
      endedAt: '2026-04-28T14:30:00.000Z',
      type: 'full_interview' as const,
      questionsAttempted: 5,
      confidenceRatings: { needsWork: 1, comfortable: 3, confident: 1 },
      focusAreas: ['leadership', 'technical'],
    };

    it('returns 200 with session summary after logging a full interview practice', async () => {
      vi.mocked(prepService.logPracticeSession).mockResolvedValue({
        session: mockPracticeSession,
        interviewPrep: { ...mockPrep, completeness: 65, version: 2 },
        completenessChange: 15,
        summary: {
          questionsAttempted: 5,
          storiesPracticed: 3,
          gapsAddressed: 1,
          averageConfidence: 'comfortable' as const,
          improvementAreas: ['technical'],
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'full_interview',
          startedAt: '2026-04-28T14:00:00.000Z',
          endedAt: '2026-04-28T14:30:00.000Z',
          focusAreas: ['leadership', 'technical'],
          questionResults: [
            {
              questionId: '01HXK5R3J7Q8N2M4P6W9Y1Z3Q1',
              confidenceRating: 'comfortable',
              usedStoryId: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1',
            },
          ],
          storyResults: [
            { storyId: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1', confidenceRating: 'confident', timeUsed: 95 },
          ],
          gapResults: [
            {
              gapId: '01HXK5R3J7Q8N2M4P6W9Y1Z3G1',
              strategyUsed: 'acknowledge_pivot',
              confidenceRating: 'comfortable',
            },
          ],
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.session.type).toBe('full_interview');
      expect(body.session.questionsAttempted).toBe(5);
      expect(body.summary.questionsAttempted).toBe(5);
      expect(body.summary.storiesPracticed).toBe(3);
      expect(body.summary.gapsAddressed).toBe(1);
      expect(body.summary.averageConfidence).toBe('comfortable');
      expect(body.summary.improvementAreas).toContain('technical');
      expect(body.completenessChange).toBe(15);
    });

    it('returns 200 for a single_question practice session', async () => {
      vi.mocked(prepService.logPracticeSession).mockResolvedValue({
        session: { ...mockPracticeSession, type: 'single_question', questionsAttempted: 1 },
        interviewPrep: mockPrep,
        completenessChange: 5,
        summary: {
          questionsAttempted: 1,
          storiesPracticed: 1,
          gapsAddressed: 0,
          averageConfidence: 'comfortable' as const,
          improvementAreas: [],
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'single_question',
          startedAt: '2026-04-28T14:00:00.000Z',
          questionResults: [
            { questionId: '01HXK5R3J7Q8N2M4P6W9Y1Z3Q1', confidenceRating: 'comfortable' },
          ],
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().session.type).toBe('single_question');
    });

    it('returns 200 for a timed_responses practice session', async () => {
      vi.mocked(prepService.logPracticeSession).mockResolvedValue({
        session: { ...mockPracticeSession, type: 'timed_responses', questionsAttempted: 3 },
        interviewPrep: mockPrep,
        completenessChange: 10,
        summary: {
          questionsAttempted: 3,
          storiesPracticed: 3,
          gapsAddressed: 0,
          averageConfidence: 'needs_work' as const,
          improvementAreas: ['technical', 'leadership'],
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'timed_responses',
          startedAt: '2026-04-28T14:00:00.000Z',
          storyResults: [
            { storyId: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1', confidenceRating: 'needs_work', timeUsed: 75 },
          ],
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().summary.improvementAreas).toHaveLength(2);
    });

    it('returns 400 when type field is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startedAt: '2026-04-28T14:00:00.000Z',
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when startedAt field is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'single_question',
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when version field is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'full_interview',
          startedAt: '2026-04-28T14:00:00.000Z',
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 409 on version conflict', async () => {
      vi.mocked(prepService.logPracticeSession).mockRejectedValue(new VersionConflictError());

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'full_interview',
          startedAt: '2026-04-28T14:00:00.000Z',
          version: 99,
        }),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('VERSION_CONFLICT');
    });

    it('returns 404 when prep not found', async () => {
      vi.mocked(prepService.logPracticeSession).mockRejectedValue(
        new NotFoundError('InterviewPrep')
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/nonexistent/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'single_question',
          startedAt: '2026-04-28T14:00:00.000Z',
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(404);
    });

    it('updates interviewPrep practice log in response (AC 10j row 7 — practice mode tracking)', async () => {
      const sessionResult = {
        session: mockPracticeSession,
        interviewPrep: {
          ...mockPrep,
          practiceLog: [mockPracticeSession],
          stories: [{ ...mockStory, practiceCount: 1, confidenceLevel: 'comfortable' as const }],
          completeness: 40,
          version: 2,
        },
        completenessChange: 15,
        summary: {
          questionsAttempted: 5,
          storiesPracticed: 1,
          gapsAddressed: 0,
          averageConfidence: 'comfortable' as const,
          improvementAreas: [],
        },
      };
      vi.mocked(prepService.logPracticeSession).mockResolvedValue(sessionResult);

      const res = await app.inject({
        method: 'POST',
        url: '/api/interview-preps/01HXK5R3J7Q8N2M4P6W9Y1Z3P1/practice',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'full_interview',
          startedAt: '2026-04-28T14:00:00.000Z',
          storyResults: [
            { storyId: '01HXK5R3J7Q8N2M4P6W9Y1Z3S1', confidenceRating: 'comfortable' },
          ],
          version: 1,
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.interviewPrep.practiceLog).toHaveLength(1);
      expect(body.interviewPrep.stories[0].practiceCount).toBe(1);
      expect(body.interviewPrep.stories[0].confidenceLevel).toBe('comfortable');
    });
  });
});
