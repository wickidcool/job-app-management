import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  uploadResume,
  listResumes,
  listResumeExports,
  getResumeExport,
  deleteResume,
  getResumeDownloadUrl,
} from '../services/resume.service.js';
import { AppError } from '../types/index.js';
import { isR2Configured } from '../services/storage.service.js';

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
  fastify.get('/resumes', async (request, reply) => {
    const resumes = await listResumes(request.userId ?? undefined);
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
        415
      );
    }

    const buffer = await data.toBuffer();
    const result = await uploadResume(buffer, data.filename, mimeType, request.userId ?? undefined);
    return reply.status(201).send(result);
  });

  // GET /api/resumes/:id/download-url — only available when R2 is configured
  fastify.get<{ Params: { id: string } }>('/resumes/:id/download-url', async (request, reply) => {
    if (!isR2Configured()) {
      throw new AppError(
        'NOT_SUPPORTED',
        'Download URLs are only available when R2 storage is configured',
        undefined,
        501
      );
    }
    const { id } = request.params;
    const result = await getResumeDownloadUrl(id, request.userId ?? undefined);
    return reply.send(result);
  });

  // GET /api/resumes/:id/exports
  fastify.get<{ Params: { id: string } }>('/resumes/:id/exports', async (request, reply) => {
    const { id } = request.params;
    const exports = await listResumeExports(id, request.userId ?? undefined);
    return reply.send({ exports });
  });

  // GET /api/resumes/:id/exports/:exportId
  fastify.get<{ Params: { id: string; exportId: string } }>(
    '/resumes/:id/exports/:exportId',
    async (request, reply) => {
      const { id, exportId } = request.params;
      const exp = await getResumeExport(id, exportId, request.userId ?? undefined);
      return reply.send(exp);
    }
  );

  // DELETE /api/resumes/:id
  fastify.delete<{ Params: { id: string } }>('/resumes/:id', async (request, reply) => {
    const { id } = request.params;
    await deleteResume(id, request.userId ?? undefined);
    return reply.status(204).send();
  });
}
