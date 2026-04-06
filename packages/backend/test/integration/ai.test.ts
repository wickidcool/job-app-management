import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let storageDir: string;

beforeEach(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'ai-integration-'));
  app = await buildApp({ storageDir, aiProvider: 'stub' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('AI routes (stub provider)', () => {
  it('POST /api/v1/ai/update/:slug returns updated content with [AI STUB]', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'My Project', content: '# Original' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/ai/update/my-project', payload: { instruction: 'Add a summary' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain('[AI STUB]');
  });

  it('POST /api/v1/ai/update/:slug returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/ai/update/ghost', payload: { instruction: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/ai/update/:slug returns 400 when instruction is missing', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Foo', content: 'content' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/ai/update/foo', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/ai/cover-letter returns non-empty coverLetter', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/ai/cover-letter', payload: { jobDescription: 'Looking for a TypeScript developer' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coverLetter.length).toBeGreaterThan(0);
  });
});
