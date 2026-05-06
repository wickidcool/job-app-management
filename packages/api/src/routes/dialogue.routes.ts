import { Hono } from 'hono';
import {
  ProjectCaptureSchema,
  ProjectEnrichSchema,
  captureProjectFile,
  enrichProjectFile,
  correctProjectFile,
} from '../services/dialogue.service.js';
import { AppError } from '../types/index.js';
import type { AppEnv } from '../types/env.js';

export const dialogueRoutes = new Hono<AppEnv>()
  .post('/projects/:projectId/capture', async (c) => {
    const parsed = ProjectCaptureSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', 'Invalid capture data', parsed.error.flatten(), 400);
    }
    const result = await captureProjectFile(
      c.req.param('projectId'),
      parsed.data,
      undefined,
      c.get('userId') ?? undefined
    );
    return c.json(result, 201);
  })
  .post('/projects/:projectId/files/:fileName/enrich', async (c) => {
    const fileName = c.req.param('fileName');
    if (!fileName.endsWith('.md')) {
      throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
    }
    const parsed = ProjectEnrichSchema.safeParse(await c.req.json());
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
    const result = await enrichProjectFile(
      c.req.param('projectId'),
      fileName,
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  })
  .post('/projects/:projectId/files/:fileName/correct', async (c) => {
    const fileName = c.req.param('fileName');
    if (!fileName.endsWith('.md')) {
      throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
    }
    const parsed = ProjectCaptureSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', 'Invalid correction data', parsed.error.flatten(), 400);
    }
    const result = await correctProjectFile(
      c.req.param('projectId'),
      fileName,
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  });
