import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let storageDir: string;

beforeEach(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'projects-integration-'));
  app = await buildApp({ storageDir, aiProvider: 'stub' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('Projects routes', () => {
  it('POST /api/v1/projects creates project and returns 201', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Test Co', content: '# Test Co' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.slug).toBe('test-co');
  });

  it('GET /api/v1/projects returns array', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Alpha', content: '# Alpha' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  it('GET /api/v1/projects/:slug returns content', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Foo', content: '# Foo content' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/foo' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain('Foo content');
  });

  it('GET /api/v1/projects/:slug returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/v1/projects/:slug updates content and regenerates index', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Bar', content: 'original' } });
    const res = await app.inject({ method: 'PUT', url: '/api/v1/projects/bar', payload: { content: 'updated content' } });
    expect(res.statusCode).toBe(200);
    const getRes = await app.inject({ method: 'GET', url: '/api/v1/projects/bar' });
    expect(getRes.json().content).toBe('updated content');
  });

  it('DELETE /api/v1/projects/:slug removes file and returns 204', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Baz', content: 'content' } });
    const deleteRes = await app.inject({ method: 'DELETE', url: '/api/v1/projects/baz' });
    expect(deleteRes.statusCode).toBe(204);
    const getRes = await app.inject({ method: 'GET', url: '/api/v1/projects/baz' });
    expect(getRes.statusCode).toBe(404);
  });

  it('upload route does not shadow :slug — /projects/upload is reachable', async () => {
    // upload route should be registered before :slug so 'upload' is not treated as a slug
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/upload',
      headers: { 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: '--boundary\r\nContent-Disposition: form-data; name="file"; filename="test.md"\r\nContent-Type: text/markdown\r\n\r\n# Uploaded\r\n--boundary--\r\n',
    });
    expect(res.statusCode).not.toBe(404);
  });
});
