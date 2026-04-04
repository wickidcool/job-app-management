import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore } from '../../src/storage/indexStore.js';
import { ProjectStore } from '../../src/storage/projectStore.js';

let storageDir: string;
let indexStore: IndexStore;
let projectStore: ProjectStore;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'index-store-test-'));
  projectStore = new ProjectStore(storageDir);
  indexStore = new IndexStore(storageDir);
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

describe('IndexStore', () => {
  it('getIndex returns empty string when index.md missing', () => {
    expect(indexStore.getIndex()).toBe('');
  });

  it('regenerateIndex creates index.md with correct structure', () => {
    projectStore.createProject('Acme Corp', '# Acme Corp\n\nBuilt with TypeScript and React.\nUsed PostgreSQL for storage.\n');
    indexStore.regenerateIndex(projectStore);
    const index = indexStore.getIndex();
    expect(index).toContain('# Project Index');
    expect(index).toContain('## Acme Corp');
    expect(index).toContain('acme-corp.md');
  });

  it('regenerateIndex extracts known tech keywords', () => {
    projectStore.createProject('Tech Project', 'Used Docker, Kubernetes, and GraphQL in this project.');
    indexStore.regenerateIndex(projectStore);
    const index = indexStore.getIndex();
    expect(index).toContain('Docker');
    expect(index).toContain('Kubernetes');
    expect(index).toContain('GraphQL');
  });

  it('regenerateIndex with no projects produces empty index', () => {
    indexStore.regenerateIndex(projectStore);
    const index = indexStore.getIndex();
    expect(index).toContain('# Project Index');
  });

  it('getIndex returns current index.md content after regenerate', () => {
    projectStore.createProject('AWS Project', 'Deployed on AWS with CI/CD pipeline.');
    indexStore.regenerateIndex(projectStore);
    const index = indexStore.getIndex();
    expect(index).toContain('AWS');
  });
});
