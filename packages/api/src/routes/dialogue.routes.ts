import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ProjectCaptureSchema,
  ProjectEnrichSchema,
  captureProjectFile,
  enrichProjectFile,
  correctProjectFile,
} from '../services/dialogue.service.js';
import { AppError } from '../types/index.js';

export async function dialogueRoutes(fastify: FastifyInstance) {
  // POST /api/projects/:projectId/capture
  // Creates a new STAR file from dialogue-captured structured data.
  fastify.post<{ Params: { projectId: string }; Body: unknown }>(
    '/projects/:projectId/capture',
    async (request, reply) => {
      const { projectId } = request.params;
      const parsed = ProjectCaptureSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid capture data', parsed.error.flatten(), 400);
      }
      const result = await captureProjectFile(projectId, parsed.data);
      return reply.status(201).send(result);
    }
  );

  // POST /api/projects/:projectId/files/:fileName/enrich  (UC-1a)
  // Merges additional STAR data into an existing sparse file.
  fastify.post<{ Params: { projectId: string; fileName: string }; Body: unknown }>(
    '/projects/:projectId/files/:fileName/enrich',
    async (request, reply) => {
      const { projectId, fileName } = request.params;
      if (!fileName.endsWith('.md')) {
        throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
      }
      const parsed = ProjectEnrichSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid enrich data', parsed.error.flatten(), 400);
      }
      if (Object.keys(parsed.data).length === 0) {
        throw new AppError(
          'BAD_REQUEST',
          'At least one field must be provided for enrichment',
          undefined,
          400
        );
      }
      const result = await enrichProjectFile(projectId, fileName, parsed.data);
      return reply.send(result);
    }
  );

  // POST /api/projects/:projectId/files/:fileName/correct  (UC-1b)
  // Replaces a file's content with fully-corrected structured data.
  fastify.post<{ Params: { projectId: string; fileName: string }; Body: unknown }>(
    '/projects/:projectId/files/:fileName/correct',
    async (request, reply) => {
      const { projectId, fileName } = request.params;
      if (!fileName.endsWith('.md')) {
        throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
      }
      const parsed = ProjectCaptureSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid correction data', parsed.error.flatten(), 400);
      }
      const result = await correctProjectFile(projectId, fileName, parsed.data);
      return reply.send(result);
    }
  );
}
