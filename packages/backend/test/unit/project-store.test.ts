import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore, NotFoundError } from '../../src/storage/projectStore.js';

let storageDir: string;
let store: ProjectStore;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'project-store-test-'));
  store = new ProjectStore(storageDir);
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

describe('ProjectStore', () => {
  it('createProject returns slug and creates file', () => {
    const slug = store.createProject('Acme Corp', '# Acme Corp\n\nContent here.');
    expect(slug).toBe('acme-corp');
    const content = store.getProject('acme-corp');
    expect(content).toContain('Acme Corp');
  });

  it('getProject throws NotFoundError for unknown slug', () => {
    expect(() => store.getProject('not-here')).toThrow(NotFoundError);
  });

  it('updateProject replaces file content', () => {
    store.createProject('Foo', 'original');
    store.updateProject('foo', 'updated');
    expect(store.getProject('foo')).toBe('updated');
  });

  it('deleteProject removes file', () => {
    store.createProject('Foo', 'content');
    store.deleteProject('foo');
    expect(() => store.getProject('foo')).toThrow(NotFoundError);
  });

  it('listProjects returns metadata array', () => {
    store.createProject('Alpha', '# Alpha');
    store.createProject('Beta', '# Beta');
    const list = store.listProjects();
    expect(list).toHaveLength(2);
    expect(list.map(p => p.slug).sort()).toEqual(['alpha', 'beta']);
    expect(list[0]).toHaveProperty('name');
    expect(list[0]).toHaveProperty('size');
    expect(list[0]).toHaveProperty('mtime');
  });

  it('slug collision appends numeric suffix', () => {
    const s1 = store.createProject('Same Name', 'a');
    const s2 = store.createProject('Same Name', 'b');
    expect(s1).toBe('same-name');
    expect(s2).toBe('same-name-2');
  });

  it('deleteProject throws NotFoundError for unknown slug', () => {
    expect(() => store.deleteProject('ghost')).toThrow(NotFoundError);
  });

  it('updateProject throws NotFoundError for unknown slug', () => {
    expect(() => store.updateProject('ghost', 'x')).toThrow(NotFoundError);
  });
});
