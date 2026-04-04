import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResume } from '../../src/resume/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/sample-resume.txt');

describe('parseResume', () => {
  it('parses plain text resume into sections', async () => {
    const buffer = readFileSync(fixturePath);
    const result = await parseResume(buffer, 'text/plain');
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.rawText).toContain('Acme Corp');
    expect(result.warnings).toEqual([]);
  });

  it('extracts experience section with entries', async () => {
    const buffer = readFileSync(fixturePath);
    const result = await parseResume(buffer, 'text/plain');
    const expSection = result.sections.find(s => s.heading.toLowerCase().includes('experience'));
    expect(expSection).toBeDefined();
    expect(expSection!.entries.length).toBeGreaterThanOrEqual(2);
    const acme = expSection!.entries.find(e => e.company.includes('Acme'));
    expect(acme).toBeDefined();
    expect(acme!.bullets.length).toBeGreaterThan(0);
  });

  it('returns rawText and warning for empty buffer', async () => {
    const buffer = Buffer.from('');
    const result = await parseResume(buffer, 'text/plain');
    expect(result.sections).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('preserves rawText on failed section parse', async () => {
    const buffer = Buffer.from('This is not a resume at all. Just some random text.');
    const result = await parseResume(buffer, 'text/plain');
    expect(result.rawText).toContain('random text');
  });
});
