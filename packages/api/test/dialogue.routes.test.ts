import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

// Mock project.service first so dialogue.service can import it without a real DB
vi.mock('../src/services/project.service.js', () => ({
  listProjects: vi.fn(),
  listProjectFiles: vi.fn(),
  getProjectFile: vi.fn(),
  updateProjectFile: vi.fn(),
  generateProjectIndex: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  getProjectBySlug: vi.fn(),
  deleteProject: vi.fn(),
  createProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
  getOrCreateProjectBySlug: vi.fn(),
  toSlug: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
}));

// Keep real Zod schemas; only mock the async service functions
vi.mock('../src/services/dialogue.service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/dialogue.service.js')>(
    '../src/services/dialogue.service.js',
  );
  return {
    ...actual,
    captureProjectFile: vi.fn(),
    enrichProjectFile: vi.fn(),
    correctProjectFile: vi.fn(),
  };
});

vi.mock('../src/services/resume.service.js', () => ({
  uploadResume: vi.fn(),
  listResumes: vi.fn(),
  listResumeExports: vi.fn(),
  getResumeExport: vi.fn(),
  deleteResume: vi.fn(),
}));

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

import * as dialogueService from '../src/services/dialogue.service.js';
import { NotFoundError, ConflictError } from '../src/types/index.js';

const validAccomplishment = {
  title: 'Improved API throughput',
  situation: 'Legacy REST API was hitting rate limits under peak load',
  task: 'Redesign the API layer to handle 10x traffic',
  action: 'Introduced Redis caching and connection pooling',
  result: 'Reduced p99 latency from 800ms to 120ms with zero downtime',
  technologies: ['Redis', 'Node.js'],
};

const validCaptureBody = {
  company: 'Acme Corp',
  role: 'Senior Engineer',
  period: 'Jan 2022 - Dec 2023',
  industry: 'Technology',
  technologies: ['TypeScript', 'Node.js'],
  jobFit: ['backend', 'platform'],
  accomplishments: [validAccomplishment],
};

const captureResult = {
  slug: 'acme-corp',
  fileName: 'acme-corp-senior-engineer.md',
  content: '---\ncompany: Acme Corp\n---\n',
};

describe('Dialogue Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp({ logger: false });
    vi.clearAllMocks();
  });

  describe('POST /api/projects/:projectId/capture', () => {
    it('returns 201 with capture result on valid body', async () => {
      vi.mocked(dialogueService.captureProjectFile).mockResolvedValue(captureResult);

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/capture',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validCaptureBody),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(captureResult);
      expect(dialogueService.captureProjectFile).toHaveBeenCalledWith(
        'acme-corp',
        expect.objectContaining({ company: 'Acme Corp', role: 'Senior Engineer' }),
      );
    });

    it('returns 400 when company is missing', async () => {
      const { company: _c, ...noCompany } = validCaptureBody;

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/capture',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(noCompany),
      });

      expect(response.statusCode).toBe(400);
      expect(dialogueService.captureProjectFile).not.toHaveBeenCalled();
    });

    it('returns 400 when accomplishments array is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/capture',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validCaptureBody, accomplishments: [] }),
      });

      expect(response.statusCode).toBe(400);
      expect(dialogueService.captureProjectFile).not.toHaveBeenCalled();
    });

    it('returns 400 when accomplishment is missing required fields', async () => {
      const badAccomplishment = { title: 'Test', situation: 'ok' }; // missing task/action/result

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/capture',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validCaptureBody, accomplishments: [badAccomplishment] }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 409 when file already exists', async () => {
      vi.mocked(dialogueService.captureProjectFile).mockRejectedValue(
        new ConflictError('File already exists'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/capture',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validCaptureBody),
      });

      expect(response.statusCode).toBe(409);
    });

    it('defaults technologies and jobFit to empty arrays when omitted', async () => {
      vi.mocked(dialogueService.captureProjectFile).mockResolvedValue(captureResult);
      const { technologies: _t, jobFit: _j, ...minimal } = validCaptureBody;

      await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/capture',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(minimal),
      });

      expect(dialogueService.captureProjectFile).toHaveBeenCalledWith(
        'acme-corp',
        expect.objectContaining({ technologies: [], jobFit: [] }),
      );
    });
  });

  describe('POST /api/projects/:projectId/files/:fileName/enrich', () => {
    it('returns 200 with updated content', async () => {
      const enrichResult = { content: '---\ncompany: Acme Corp\n---\n# Updated\n' };
      vi.mocked(dialogueService.enrichProjectFile).mockResolvedValue(enrichResult);

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/acme-corp-senior-engineer.md/enrich',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ industry: 'Fintech', jobFit: ['payments'] }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(enrichResult);
      expect(dialogueService.enrichProjectFile).toHaveBeenCalledWith(
        'acme-corp',
        'acme-corp-senior-engineer.md',
        expect.objectContaining({ industry: 'Fintech', jobFit: ['payments'] }),
      );
    });

    it('returns 400 for non-.md file', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/file.txt/enrich',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ industry: 'Tech' }),
      });

      expect(response.statusCode).toBe(400);
      expect(dialogueService.enrichProjectFile).not.toHaveBeenCalled();
    });

    it('returns 400 when body is empty object', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/acme-corp-senior-engineer.md/enrich',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(400);
      expect(dialogueService.enrichProjectFile).not.toHaveBeenCalled();
    });

    it('returns 404 when file not found', async () => {
      vi.mocked(dialogueService.enrichProjectFile).mockRejectedValue(
        new NotFoundError('Project file'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/missing.md/enrich',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ industry: 'Tech' }),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/projects/:projectId/files/:fileName/correct', () => {
    it('returns 200 with corrected content', async () => {
      const correctResult = { content: '---\ncompany: Acme Corp\n---\n# Corrected\n' };
      vi.mocked(dialogueService.correctProjectFile).mockResolvedValue(correctResult);

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/acme-corp-senior-engineer.md/correct',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validCaptureBody),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(correctResult);
      expect(dialogueService.correctProjectFile).toHaveBeenCalledWith(
        'acme-corp',
        'acme-corp-senior-engineer.md',
        expect.objectContaining({ company: 'Acme Corp' }),
      );
    });

    it('returns 400 for non-.md file', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/file.txt/correct',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validCaptureBody),
      });

      expect(response.statusCode).toBe(400);
      expect(dialogueService.correctProjectFile).not.toHaveBeenCalled();
    });

    it('returns 400 when role is missing', async () => {
      const { role: _r, ...noRole } = validCaptureBody;

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/acme-corp-senior-engineer.md/correct',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(noRole),
      });

      expect(response.statusCode).toBe(400);
      expect(dialogueService.correctProjectFile).not.toHaveBeenCalled();
    });

    it('returns 404 when file not found', async () => {
      vi.mocked(dialogueService.correctProjectFile).mockRejectedValue(
        new NotFoundError('Project file'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/acme-corp/files/missing.md/correct',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validCaptureBody),
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
