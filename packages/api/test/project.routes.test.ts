import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

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
}));

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

import * as projectService from '../src/services/project.service.js';
import * as resumeService from '../src/services/resume.service.js';
import { NotFoundError } from '../src/types/index.js';

const mockProject = {
  id: 'acme-corp',
  name: 'Acme Corp',
  fileCount: 2,
  updatedAt: '2026-04-17T10:00:00.000Z',
};

const mockFileMeta = {
  fileName: 'resume-01HXTEST000000000000000001.md',
  size: 1234,
  updatedAt: '2026-04-17T10:00:00.000Z',
};

describe('Project Routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  describe('GET /api/projects', () => {
    it('returns 200 with list of projects', async () => {
      vi.mocked(projectService.listProjects).mockResolvedValue([mockProject]);

      const response = await app.request('/api/projects', { method: 'GET' })

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ projects: [mockProject] });
    });

    it('returns empty array when no projects exist', async () => {
      vi.mocked(projectService.listProjects).mockResolvedValue([]);

      const response = await app.request('/api/projects', { method: 'GET' })

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ projects: [] });
    });
  });

  describe('GET /api/projects/:projectId/files', () => {
    it('returns 200 with file list', async () => {
      vi.mocked(projectService.listProjectFiles).mockResolvedValue([mockFileMeta]);

      const response = await app.request('/api/projects/acme-corp/files', { method: 'GET' })

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ files: [mockFileMeta] });
      expect(projectService.listProjectFiles).toHaveBeenCalledWith('acme-corp', undefined);
    });

    it('returns 404 when project not found', async () => {
      vi.mocked(projectService.listProjectFiles).mockRejectedValue(new NotFoundError('Project'));

      const response = await app.request('/api/projects/nonexistent/files', { method: 'GET' })

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/projects/:projectId/files/:fileName', () => {
    it('returns 200 with file content as JSON', async () => {
      const content = '# Resume\n\nSome content';
      vi.mocked(projectService.getProjectFile).mockResolvedValue(content);

      const response = await app.request('/api/projects/acme-corp/files/resume-01HXTEST000000000000000001.md', { method: 'GET' })

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ content });
      expect(projectService.getProjectFile).toHaveBeenCalledWith(
        'acme-corp',
        'resume-01HXTEST000000000000000001.md',
        undefined
      );
    });

    it('returns 404 when file not found', async () => {
      vi.mocked(projectService.getProjectFile).mockRejectedValue(new NotFoundError('Project file'));

      const response = await app.request('/api/projects/acme-corp/files/missing.md', { method: 'GET' })

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/projects/:projectId/files/:fileName', () => {
    it('returns 204 on successful update', async () => {
      vi.mocked(projectService.updateProjectFile).mockResolvedValue(undefined);

      const response = await app.request('/api/projects/acme-corp/files/resume-01HXTEST000000000000000001.md', {
        method: 'PUT',
        body: JSON.stringify({ content: '# Updated content' }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      })

      expect(response.status).toBe(204);
      expect(projectService.updateProjectFile).toHaveBeenCalledWith(
        'acme-corp',
        'resume-01HXTEST000000000000000001.md',
        '# Updated content',
        undefined
      );
    });

    it('returns 404 when project not found', async () => {
      vi.mocked(projectService.updateProjectFile).mockRejectedValue(new NotFoundError('Project'));

      const response = await app.request('/api/projects/nonexistent/files/resume.md', {
        method: 'PUT',
        body: JSON.stringify({ content: 'hello' }),
        headers: { 'Content-Type': 'application/json', ...{ 'content-type': 'application/json' } },
      })

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/projects/generate-index', () => {
    it('returns 201 with index path and project count', async () => {
      vi.mocked(projectService.generateProjectIndex).mockResolvedValue({
        path: '/data/projects/index.md',
        projectCount: 3,
      });

      const response = await app.request('/api/projects/generate-index', { method: 'POST' })

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ path: '/data/projects/index.md', projectCount: 3 });
    });
  });

  describe('DELETE /api/resumes/:id', () => {
    it('returns 204 on successful delete', async () => {
      vi.mocked(resumeService.deleteResume).mockResolvedValue(undefined);

      const response = await app.request('/api/resumes/01HXTEST000000000000000001', { method: 'DELETE' })

      expect(response.status).toBe(204);
      expect(resumeService.deleteResume).toHaveBeenCalledWith(
        '01HXTEST000000000000000001',
        undefined
      );
    });

    it('returns 404 when resume not found', async () => {
      vi.mocked(resumeService.deleteResume).mockRejectedValue(new NotFoundError('Resume'));

      const response = await app.request('/api/resumes/nonexistent', { method: 'DELETE' })

      expect(response.status).toBe(404);
    });
  });
});
