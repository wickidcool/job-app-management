import type { FastifyInstance } from 'fastify';
import {
  listProjects,
  listProjectFiles,
  getProjectFile,
  updateProjectFile,
  generateProjectIndex,
} from '../services/project.service.js';
import { AppError } from '../types/index.js';

export async function projectsRoutes(fastify: FastifyInstance) {
  // GET /api/projects
  fastify.get('/projects', async (_request, reply) => {
    const projects = await listProjects();
    return reply.send({ projects });
  });

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
      return reply.type('text/plain').send(content);
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

  // POST /api/projects/generate-index
  fastify.post('/projects/generate-index', async (_request, reply) => {
    const result = await generateProjectIndex();
    return reply.status(201).send(result);
  });
}
