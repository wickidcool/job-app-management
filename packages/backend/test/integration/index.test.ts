import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let storageDir: string;

beforeEach(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'index-integration-'));
  app = await buildApp({ storageDir, aiProvider: 'stub' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('Index routes', () => {
  it('GET /api/v1/index returns empty content when no projects exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/index' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('content');
    expect(typeof body.content).toBe('string');
  });

  it('GET /api/v1/index returns content with # Project Index after project is created', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Index Test Alpha', content: '# Index Test Alpha\n\nTypeScript React' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/index' });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain('# Project Index');
  });

  it('POST /api/v1/index/regenerate returns updated index content containing all project slugs', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Alpha Project', content: '# Alpha Project\n\nTypeScript Docker' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Beta Project', content: '# Beta Project\n\nPython Django' },
    });
    const res = await app.inject({ method: 'POST', url: '/api/v1/index/regenerate' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('content');
    expect(body.content).toContain('alpha-project');
    expect(body.content).toContain('beta-project');
  });

  it('POST /api/v1/index/regenerate with no projects returns index with heading only', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/index/regenerate' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain('# Project Index');
    expect(body.content).not.toContain('## ');
  });
});
