import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));

let app: FastifyInstance;
let storageDir: string;

beforeEach(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'resume-integration-'));
  app = await buildApp({ storageDir, aiProvider: 'stub' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('Resume routes', () => {
  it('POST /api/v1/resume/parse with plain text returns sections', async () => {
    const fixturePath = join(__dirname, '../fixtures/sample-resume.txt');
    const fileContent = readFileSync(fixturePath);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resume/parse',
      headers: { 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: `--boundary\r\nContent-Disposition: form-data; name="file"; filename="resume.txt"\r\nContent-Type: text/plain\r\n\r\n${fileContent.toString()}\r\n--boundary--\r\n`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('sections');
    expect(body).toHaveProperty('rawText');
    expect(body.rawText).toContain('Acme Corp');
  });

  it('POST /api/v1/resume/parse returns 400 when no file is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resume/parse',
      headers: { 'content-type': 'multipart/form-data; boundary=boundary' },
      payload: '--boundary--\r\n',
    });
    expect(res.statusCode).toBe(400);
  });
});
