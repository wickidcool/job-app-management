import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { uploadResume, listResumes, listResumeExports, getResumeExport } from '../services/resume.service.js';
import { deleteResume } from '../services/project.service.js';
import { AppError } from '../types/index.js';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function resumesRoutes(fastify: FastifyInstance) {
  fastify.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  });

  // GET /api/resumes
  fastify.get('/resumes', async (_request, reply) => {
    const resumes = await listResumes();
    return reply.send({ resumes });
  });

  // POST /api/resumes/upload
  fastify.post('/resumes/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      throw new AppError('BAD_REQUEST', 'No file provided', undefined, 400);
    }

    const mimeType = data.mimetype;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new AppError(
        'UNSUPPORTED_FILE_TYPE',
        'Only PDF and DOCX files are accepted',
        { received: mimeType },
        415,
      );
    }

    const buffer = await data.toBuffer();
    const result = await uploadResume(buffer, data.filename, mimeType);
    return reply.status(201).send(result);
  });

  // GET /api/resumes/:id/exports
  fastify.get<{ Params: { id: string } }>('/resumes/:id/exports', async (request, reply) => {
    const { id } = request.params;
    const exports = await listResumeExports(id);
    return reply.send({ exports });
  });

  // GET /api/resumes/:id/exports/:exportId
  fastify.get<{ Params: { id: string; exportId: string } }>(
    '/resumes/:id/exports/:exportId',
    async (request, reply) => {
      const { id, exportId } = request.params;
      const exp = await getResumeExport(id, exportId);
      return reply.send(exp);
    },
  );

  // DELETE /api/resumes/:id
  fastify.delete<{ Params: { id: string } }>('/resumes/:id', async (request, reply) => {
    const { id } = request.params;
    await deleteResume(id);
    return reply.status(204).send();
  });
}
