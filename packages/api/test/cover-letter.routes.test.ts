import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/cover-letter.service.js', () => ({
  generateCoverLetter: vi.fn(),
  getCoverLetter: vi.fn(),
  listCoverLetters: vi.fn(),
  updateCoverLetter: vi.fn(),
  deleteCoverLetter: vi.fn(),
  reviseCoverLetter: vi.fn(),
  generateOutreach: vi.fn(),
  exportCoverLetter: vi.fn(),
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

vi.mock('../src/services/dialogue.service.js', () => ({
  processDialogue: vi.fn(),
}));

vi.mock('../src/services/project.service.js', () => ({
  createProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

import * as coverLetterService from '../src/services/cover-letter.service.js';
import { NotFoundError, CoverLetterError, VersionConflictError } from '../src/types/index.js';

const mockCoverLetter = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
  status: 'draft' as const,
  title: 'Cover Letter - Senior Software Engineer at Acme Corp',
  targetCompany: 'Acme Corp',
  targetRole: 'Senior Software Engineer',
  tone: 'professional' as const,
  lengthVariant: 'standard' as const,
  jobDescriptionText: null,
  jobDescriptionUrl: null,
  jobFitAnalysisId: null,
  selectedStarEntryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3C7'],
  content: 'Dear Hiring Manager,\n\nI am writing to express my interest...',
  revisionHistory: [],
  createdAt: '2026-04-26T14:30:00.000Z',
  updatedAt: '2026-04-26T14:30:00.000Z',
  version: 1,
};

const mockUsedStarEntries = [
  {
    id: '01HXK5R3J7Q8N2M4P6W9Y1Z3C7',
    rawText: 'Reduced API response times by 40%',
    placement: 'body' as const,
  },
];

describe('Cover Letter Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp({ logger: false });
    vi.clearAllMocks();
  });

  describe('POST /api/cover-letters/generate', () => {
    it('returns 201 with generated cover letter', async () => {
      vi.mocked(coverLetterService.generateCoverLetter).mockResolvedValue({
        coverLetter: mockCoverLetter,
        usedStarEntries: mockUsedStarEntries,
        matchedThemes: ['performance-optimization'],
        warnings: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/generate',
        payload: {
          jobDescriptionText:
            'We are looking for a Senior Software Engineer with TypeScript expertise and 5+ years of experience building distributed systems at scale.',
          selectedStarEntryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3C7'],
          targetCompany: 'Acme Corp',
          targetRole: 'Senior Software Engineer',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.coverLetter.id).toBe(mockCoverLetter.id);
      expect(body.usedStarEntries).toHaveLength(1);
      expect(body.matchedThemes).toContain('performance-optimization');
    });

    it('returns 400 if no job context provided', async () => {
      vi.mocked(coverLetterService.generateCoverLetter).mockRejectedValue(
        new CoverLetterError('JOB_CONTEXT_REQUIRED', 'Provide job context')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/generate',
        payload: {
          selectedStarEntryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3C7'],
          targetCompany: 'Acme Corp',
          targetRole: 'Engineer',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 if selectedStarEntryIds is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/generate',
        payload: {
          jobDescriptionText:
            'We are looking for a senior engineer with 5+ years of TypeScript experience and background in distributed systems architecture.',
          selectedStarEntryIds: [],
          targetCompany: 'Acme Corp',
          targetRole: 'Engineer',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 if more than 10 STAR entries provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/generate',
        payload: {
          jobDescriptionText:
            'We are looking for a senior engineer with 5+ years experience in TypeScript and distributed systems.',
          selectedStarEntryIds: Array.from(
            { length: 11 },
            (_, i) => `01HXK5R3J7Q8N2M4P6W9Y1Z${String(i).padStart(3, '0')}`
          ),
          targetCompany: 'Acme Corp',
          targetRole: 'Engineer',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 if targetCompany missing when no jobFitAnalysisId', async () => {
      vi.mocked(coverLetterService.generateCoverLetter).mockRejectedValue(
        new CoverLetterError('TARGET_INFO_REQUIRED', 'targetCompany and targetRole required')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/generate',
        payload: {
          jobDescriptionText:
            'We are looking for a senior engineer with 5+ years experience in TypeScript.',
          selectedStarEntryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3C7'],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 201 with optional tone and lengthVariant', async () => {
      vi.mocked(coverLetterService.generateCoverLetter).mockResolvedValue({
        coverLetter: { ...mockCoverLetter, tone: 'enthusiastic', lengthVariant: 'concise' },
        usedStarEntries: mockUsedStarEntries,
        matchedThemes: [],
        warnings: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/generate',
        payload: {
          jobDescriptionText:
            'We are looking for a senior engineer with 5+ years TypeScript experience.',
          selectedStarEntryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3C7'],
          targetCompany: 'Acme Corp',
          targetRole: 'Engineer',
          tone: 'enthusiastic',
          lengthVariant: 'concise',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().coverLetter.tone).toBe('enthusiastic');
      expect(response.json().coverLetter.lengthVariant).toBe('concise');
    });

    it('returns 400 if both jobDescriptionText and jobDescriptionUrl provided', async () => {
      vi.mocked(coverLetterService.generateCoverLetter).mockRejectedValue(
        new CoverLetterError('JOB_CONTEXT_CONFLICT', 'Conflict')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/generate',
        payload: {
          jobDescriptionText:
            'We are looking for a senior engineer with 5+ years of TypeScript expertise and distributed systems knowledge.',
          jobDescriptionUrl: 'https://example.com/jobs/1',
          selectedStarEntryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3C7'],
          targetCompany: 'Acme Corp',
          targetRole: 'Engineer',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/cover-letters', () => {
    it('returns 200 with list', async () => {
      vi.mocked(coverLetterService.listCoverLetters).mockResolvedValue({
        coverLetters: [
          {
            id: mockCoverLetter.id,
            status: mockCoverLetter.status,
            title: mockCoverLetter.title,
            targetCompany: mockCoverLetter.targetCompany,
            targetRole: mockCoverLetter.targetRole,
            tone: mockCoverLetter.tone,
            lengthVariant: mockCoverLetter.lengthVariant,
            preview: mockCoverLetter.content.slice(0, 200),
            createdAt: mockCoverLetter.createdAt,
            updatedAt: mockCoverLetter.updatedAt,
          },
        ],
      });

      const response = await app.inject({ method: 'GET', url: '/api/cover-letters' });
      expect(response.statusCode).toBe(200);
      expect(response.json().coverLetters).toHaveLength(1);
    });

    it('passes status filter', async () => {
      vi.mocked(coverLetterService.listCoverLetters).mockResolvedValue({ coverLetters: [] });
      const response = await app.inject({
        method: 'GET',
        url: '/api/cover-letters?status=draft',
      });
      expect(response.statusCode).toBe(200);
      expect(coverLetterService.listCoverLetters).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft' })
      );
    });

    it('passes company filter', async () => {
      vi.mocked(coverLetterService.listCoverLetters).mockResolvedValue({ coverLetters: [] });
      await app.inject({ method: 'GET', url: '/api/cover-letters?company=Acme' });
      expect(coverLetterService.listCoverLetters).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'Acme' })
      );
    });

    it('passes search filter', async () => {
      vi.mocked(coverLetterService.listCoverLetters).mockResolvedValue({ coverLetters: [] });
      await app.inject({ method: 'GET', url: '/api/cover-letters?search=typescript' });
      expect(coverLetterService.listCoverLetters).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'typescript' })
      );
    });

    it('returns nextCursor for pagination', async () => {
      const cursor = Buffer.from('20').toString('base64url');
      vi.mocked(coverLetterService.listCoverLetters).mockResolvedValue({
        coverLetters: [],
        nextCursor: cursor,
      });
      const response = await app.inject({ method: 'GET', url: '/api/cover-letters?limit=20' });
      expect(response.statusCode).toBe(200);
      expect(response.json().nextCursor).toBe(cursor);
    });

    it('passes cursor to service', async () => {
      const cursor = Buffer.from('20').toString('base64url');
      vi.mocked(coverLetterService.listCoverLetters).mockResolvedValue({ coverLetters: [] });
      await app.inject({ method: 'GET', url: `/api/cover-letters?cursor=${cursor}` });
      expect(coverLetterService.listCoverLetters).toHaveBeenCalledWith(
        expect.objectContaining({ cursor })
      );
    });
  });

  describe('GET /api/cover-letters/:id', () => {
    it('returns 200 with cover letter', async () => {
      vi.mocked(coverLetterService.getCoverLetter).mockResolvedValue({
        coverLetter: mockCoverLetter,
        usedStarEntries: mockUsedStarEntries,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().coverLetter.id).toBe(mockCoverLetter.id);
    });

    it('returns 404 when not found', async () => {
      vi.mocked(coverLetterService.getCoverLetter).mockRejectedValue(
        new NotFoundError('Cover letter')
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/cover-letters/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/cover-letters/:id', () => {
    it('returns 200 with updated cover letter', async () => {
      const updated = { ...mockCoverLetter, title: 'New Title', version: 2 };
      vi.mocked(coverLetterService.updateCoverLetter).mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
        payload: { title: 'New Title', version: 1 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().coverLetter.title).toBe('New Title');
    });

    it('returns 409 on version conflict', async () => {
      vi.mocked(coverLetterService.updateCoverLetter).mockRejectedValue(
        new CoverLetterError('COVER_LETTER_VERSION_CONFLICT', 'Version mismatch', undefined, 409)
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
        payload: { version: 99 },
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 404 when cover letter not found', async () => {
      vi.mocked(coverLetterService.updateCoverLetter).mockRejectedValue(
        new NotFoundError('Cover letter')
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/cover-letters/nonexistent',
        payload: { version: 1 },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/cover-letters/:id', () => {
    it('returns 204 on success', async () => {
      vi.mocked(coverLetterService.deleteCoverLetter).mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 404 when not found', async () => {
      vi.mocked(coverLetterService.deleteCoverLetter).mockRejectedValue(
        new NotFoundError('Cover letter')
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/cover-letters/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/cover-letters/:id/revise', () => {
    it('returns 200 with revised cover letter', async () => {
      const revised = {
        ...mockCoverLetter,
        content: 'Dear Hiring Manager,\n\nI am thrilled to apply...',
        version: 2,
        revisionHistory: [
          {
            id: 'rev1',
            instructions: 'Make it more enthusiastic',
            previousContent: mockCoverLetter.content,
            createdAt: '2026-04-26T15:00:00.000Z',
          },
        ],
      };
      vi.mocked(coverLetterService.reviseCoverLetter).mockResolvedValue({
        coverLetter: revised,
        changesApplied: ['Updated opening tone'],
        usedStarEntries: mockUsedStarEntries,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/revise',
        payload: { instructions: 'Make the opening more enthusiastic', version: 1 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().coverLetter.version).toBe(2);
      expect(response.json().changesApplied).toHaveLength(1);
    });

    it('returns 400 if instructions too short', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/revise',
        payload: { instructions: 'short', version: 1 },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 409 on version conflict during revise', async () => {
      vi.mocked(coverLetterService.reviseCoverLetter).mockRejectedValue(new VersionConflictError());

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/revise',
        payload: { instructions: 'Make the opening more enthusiastic and compelling', version: 99 },
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 404 when cover letter not found during revise', async () => {
      vi.mocked(coverLetterService.reviseCoverLetter).mockRejectedValue(
        new NotFoundError('Cover letter')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/nonexistent/revise',
        payload: { instructions: 'Make the opening more enthusiastic and compelling', version: 1 },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 200 with optional tone and star entry overrides', async () => {
      const revised = {
        ...mockCoverLetter,
        tone: 'conversational' as const,
        content: 'Hey! I am thrilled to apply...',
        version: 2,
        revisionHistory: [
          {
            id: 'rev1',
            instructions: 'Use conversational tone',
            previousContent: mockCoverLetter.content,
            createdAt: '2026-04-26T15:00:00.000Z',
          },
        ],
      };
      vi.mocked(coverLetterService.reviseCoverLetter).mockResolvedValue({
        coverLetter: revised,
        changesApplied: ['Updated tone to conversational'],
        usedStarEntries: mockUsedStarEntries,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/revise',
        payload: {
          instructions: 'Rewrite using a friendly conversational tone throughout',
          selectedStarEntryIds: ['01HXK5R3J7Q8N2M4P6W9Y1Z3C7'],
          tone: 'conversational',
          version: 1,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().coverLetter.tone).toBe('conversational');
    });
  });

  describe('POST /api/cover-letters/outreach', () => {
    it('returns 201 with outreach message', async () => {
      const mockOutreach = {
        id: '01HXK5R3J7Q8N2M4P6W9Y1Z3G1',
        platform: 'linkedin' as const,
        targetCompany: 'Acme Corp',
        targetRole: 'Senior Software Engineer',
        subject: null,
        body: 'Hi Sarah,\n\nI came across your opening...',
        characterCount: 150,
        createdAt: '2026-04-26T15:00:00.000Z',
      };
      vi.mocked(coverLetterService.generateOutreach).mockResolvedValue({ message: mockOutreach });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/outreach',
        payload: {
          platform: 'linkedin',
          targetCompany: 'Acme Corp',
          coverLetterId: '01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().message.platform).toBe('linkedin');
    });

    it('returns 201 with email outreach including subject', async () => {
      const mockEmailOutreach = {
        id: '01HXK5R3J7Q8N2M4P6W9Y1Z3G2',
        platform: 'email' as const,
        targetCompany: 'Acme Corp',
        targetRole: 'Senior Software Engineer',
        subject: 'Interested in Senior Software Engineer role at Acme Corp',
        body: 'Dear Sarah,\n\nI am reaching out regarding your opening...',
        characterCount: 200,
        createdAt: '2026-04-26T15:00:00.000Z',
      };
      vi.mocked(coverLetterService.generateOutreach).mockResolvedValue({
        message: mockEmailOutreach,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/outreach',
        payload: {
          platform: 'email',
          targetCompany: 'Acme Corp',
          targetRole: 'Senior Software Engineer',
          coverLetterId: '01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().message.platform).toBe('email');
      expect(response.json().message.subject).toBeTruthy();
    });

    it('returns 400 if more than 3 STAR entries for outreach', async () => {
      vi.mocked(coverLetterService.generateOutreach).mockRejectedValue(
        new CoverLetterError('STAR_ENTRIES_LIMIT', 'Maximum 3 STAR entries for outreach')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/outreach',
        payload: {
          platform: 'linkedin',
          targetCompany: 'Acme Corp',
          selectedStarEntryIds: ['id1', 'id2', 'id3', 'id4'],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 if no content source provided', async () => {
      vi.mocked(coverLetterService.generateOutreach).mockRejectedValue(
        new CoverLetterError('JOB_CONTEXT_REQUIRED', 'Provide content source')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/outreach',
        payload: { platform: 'linkedin', targetCompany: 'Acme Corp' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/cover-letters/:id/export', () => {
    it('returns JSON with base64Content even without Accept: application/json header', async () => {
      const fakeBuffer = Buffer.from('fake-docx-content');
      vi.mocked(coverLetterService.exportCoverLetter).mockResolvedValue({
        buffer: fakeBuffer,
        filename: 'cover-letter-acme-corp-2026-04-26.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/export',
        payload: { format: 'docx' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.filename).toContain('.docx');
      expect(body.base64Content).toBe(fakeBuffer.toString('base64'));
    });

    it('returns JSON when Accept: application/json', async () => {
      const fakeBuffer = Buffer.from('fake-docx-content');
      vi.mocked(coverLetterService.exportCoverLetter).mockResolvedValue({
        buffer: fakeBuffer,
        filename: 'cover-letter-acme-corp-2026-04-26.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/export',
        payload: { format: 'docx' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.filename).toContain('.docx');
      expect(body.base64Content).toBe(fakeBuffer.toString('base64'));
    });

    it('returns 404 when cover letter not found during export', async () => {
      vi.mocked(coverLetterService.exportCoverLetter).mockRejectedValue(
        new NotFoundError('Cover letter')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/nonexistent/export',
        payload: { format: 'docx' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns JSON with includeHeader info when Accept: application/json', async () => {
      const fakeBuffer = Buffer.from('fake-docx-with-header');
      vi.mocked(coverLetterService.exportCoverLetter).mockResolvedValue({
        buffer: fakeBuffer,
        filename: 'cover-letter-acme-corp-2026-04-26.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/export',
        payload: {
          format: 'docx',
          includeHeader: true,
          headerInfo: { name: 'Jane Doe', email: 'jane@example.com', phone: '555-1234' },
          fontSize: 12,
        },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().fileSize).toBe(fakeBuffer.length);
      expect(coverLetterService.exportCoverLetter).toHaveBeenCalledWith(
        '01HXK5R3J7Q8N2M4P6W9Y1Z3E1',
        expect.objectContaining({ includeHeader: true, fontSize: 12 })
      );
    });

    it('returns 400 for invalid format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/export',
        payload: { format: 'txt' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
