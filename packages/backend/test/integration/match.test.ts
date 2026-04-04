import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let storageDir: string;

beforeEach(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'match-integration-'));
  app = await buildApp({ storageDir, aiProvider: 'stub' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('Match routes', () => {
  it('POST /api/v1/match returns match result', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'React Project', content: 'Used TypeScript and React in this project.' } });
    await app.inject({ method: 'POST', url: '/api/v1/index/regenerate' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/match', payload: { jobDescription: 'Looking for TypeScript and React developer' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('score');
    expect(body).toHaveProperty('matchedKeywords');
    expect(body).toHaveProperty('missedKeywords');
    expect(body).toHaveProperty('projectScores');
  });
});
