import { Hono } from 'hono';
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
import type { AppEnv } from '../types/env.js';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const resumesRoutes = new Hono<AppEnv>()
  .get('/resumes', async (c) => {
    const resumes = await listResumes(c.get('userId') ?? undefined);
    return c.json({ resumes });
  })
  .post('/resumes/upload', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || typeof file === 'string') {
      throw new AppError('BAD_REQUEST', 'No file provided', undefined, 400);
    }

    const mimeType = file.type;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new AppError(
        'UNSUPPORTED_FILE_TYPE',
        'Only PDF and DOCX files are accepted',
        { received: mimeType },
        415
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      throw new AppError('FILE_TOO_LARGE', 'File exceeds 10 MB limit', undefined, 413);
    }

    const buffer = Buffer.from(arrayBuffer);
    const result = await uploadResume(buffer, file.name, mimeType, c.get('userId') ?? undefined);
    return c.json(result, 201);
  })
  .get('/resumes/:id/download-url', async (c) => {
    if (!isR2Configured()) {
      throw new AppError(
        'NOT_SUPPORTED',
        'Download URLs are only available when R2 storage is configured',
        undefined,
        501
      );
    }
    const result = await getResumeDownloadUrl(c.req.param('id'), c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/resumes/:id/exports', async (c) => {
    const exports = await listResumeExports(c.req.param('id'), c.get('userId') ?? undefined);
    return c.json({ exports });
  })
  .get('/resumes/:id/exports/:exportId', async (c) => {
    const exp = await getResumeExport(
      c.req.param('id'),
      c.req.param('exportId'),
      c.get('userId') ?? undefined
    );
    return c.json(exp);
  })
  .delete('/resumes/:id', async (c) => {
    await deleteResume(c.req.param('id'), c.get('userId') ?? undefined);
    return c.body(null, 204);
  });
