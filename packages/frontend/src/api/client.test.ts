import { describe, it, expect } from 'vitest';
import * as client from './client.js';

describe('API client exports', () => {
  it('exports expected functions', () => {
    expect(typeof client.listProjects).toBe('function');
    expect(typeof client.getProject).toBe('function');
    expect(typeof client.createProject).toBe('function');
    expect(typeof client.updateProject).toBe('function');
    expect(typeof client.deleteProject).toBe('function');
    expect(typeof client.uploadMarkdown).toBe('function');
    expect(typeof client.parseResume).toBe('function');
    expect(typeof client.getIndex).toBe('function');
    expect(typeof client.regenerateIndex).toBe('function');
    expect(typeof client.aiUpdateProject).toBe('function');
    expect(typeof client.generateCoverLetter).toBe('function');
    expect(typeof client.matchJobDescription).toBe('function');
  });
});
