import type { FastifyInstance } from 'fastify';
import {
  listProjects,
  listProjectFiles,
  getProjectFile,
  updateProjectFile,
  generateProjectIndex,
  createProject,
  getProject,
  getProjectBySlug,
  deleteProject,
  createProjectFile,
  deleteProjectFile,
} from '../services/project.service.js';
import { AppError } from '../types/index.js';

export async function projectsRoutes(fastify: FastifyInstance) {
  // GET /api/projects
  fastify.get('/projects', async (_request, reply) => {
    const projects = await listProjects();
    return reply.send({ projects });
  });

  // POST /api/projects
  fastify.post<{ Body: { name: string; slug?: string; description?: string } }>(
    '/projects',
    async (request, reply) => {
      const { name, slug, description } = request.body as { name: string; slug?: string; description?: string };
      if (!name || typeof name !== 'string') {
        throw new AppError('BAD_REQUEST', 'name is required', undefined, 400);
      }
      const project = await createProject({ name, slug, description });
      return reply.status(201).send(project);
    },
  );

  // GET /api/projects/:projectId
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId',
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await getProjectBySlug(projectId);
      return reply.send(project);
    },
  );

  // DELETE /api/projects/:projectId
  fastify.delete<{ Params: { projectId: string } }>(
    '/projects/:projectId',
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await getProjectBySlug(projectId);
      await deleteProject(project.id);
      return reply.status(204).send();
    },
  );

  // GET /api/projects/:projectId/files
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/files',
    async (request, reply) => {
      const { projectId } = request.params;
      const files = await listProjectFiles(projectId);
      return reply.send({ files });
    },
  );

  // GET /api/projects/:projectId/files/:fileName
  fastify.get<{ Params: { projectId: string; fileName: string } }>(
    '/projects/:projectId/files/:fileName',
    async (request, reply) => {
      const { projectId, fileName } = request.params;
      const content = await getProjectFile(projectId, fileName);
      return reply.send({ content });
    },
  );

  // PUT /api/projects/:projectId/files/:fileName
  fastify.put<{ Params: { projectId: string; fileName: string }; Body: { content: string } }>(
    '/projects/:projectId/files/:fileName',
    async (request, reply) => {
      const { projectId, fileName } = request.params;
      const { content } = request.body as { content: string };
      if (typeof content !== 'string') {
        throw new AppError('BAD_REQUEST', 'content must be a string', undefined, 400);
      }
      await updateProjectFile(projectId, fileName, content);
      return reply.status(204).send();
    },
  );

  // POST /api/projects/:projectId/files
  fastify.post<{ Params: { projectId: string }; Body: { fileName: string; content: string } }>(
    '/projects/:projectId/files',
    async (request, reply) => {
      const { projectId } = request.params;
      const { fileName, content } = request.body as { fileName: string; content: string };
      if (!fileName || typeof fileName !== 'string') {
        throw new AppError('BAD_REQUEST', 'fileName is required', undefined, 400);
      }
      if (typeof content !== 'string') {
        throw new AppError('BAD_REQUEST', 'content must be a string', undefined, 400);
      }
      await createProjectFile(projectId, fileName, content);
      return reply.status(201).send({ fileName });
    },
  );

  // DELETE /api/projects/:projectId/files/:fileName
  fastify.delete<{ Params: { projectId: string; fileName: string } }>(
    '/projects/:projectId/files/:fileName',
    async (request, reply) => {
      const { projectId, fileName } = request.params;
      await deleteProjectFile(projectId, fileName);
      return reply.status(204).send();
    },
  );

  // POST /api/projects/generate-index
  fastify.post('/projects/generate-index', async (_request, reply) => {
    const result = await generateProjectIndex();
    return reply.status(201).send(result);
  });
}
