import { describe, it, expect } from 'vitest';
import { createAIProvider } from '../../src/ai/factory.js';

describe('createAIProvider', () => {
  it('returns stub when provider is stub', () => {
    const provider = createAIProvider({ AI_PROVIDER: 'stub' });
    expect(provider).toBeDefined();
  });

  it('stub updateProjectFile returns string containing [AI STUB]', async () => {
    const provider = createAIProvider({ AI_PROVIDER: 'stub' });
    const result = await provider.updateProjectFile('# Old Content', 'Add a summary');
    expect(result).toContain('[AI STUB]');
  });

  it('stub generateCoverLetter returns non-empty string', async () => {
    const provider = createAIProvider({ AI_PROVIDER: 'stub' });
    const result = await provider.generateCoverLetter('index content', 'job description');
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws for unknown provider', () => {
    expect(() => createAIProvider({ AI_PROVIDER: 'unknown' as 'stub' })).toThrow();
  });

  it('throws for anthropic without API key', () => {
    expect(() => createAIProvider({ AI_PROVIDER: 'anthropic', AI_API_KEY: undefined })).toThrow(/API key/i);
  });
});
