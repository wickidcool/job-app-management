import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMService } from '../src/services/llm.service.js';
import { _resetConfig } from '../src/config.js';

// Mock @anthropic-ai/sdk
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

async function getMockCreate() {
  const mod = await import('@anthropic-ai/sdk');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).__mockCreate as ReturnType<typeof vi.fn>;
}

const PARSED_JD_FIXTURE = {
  roleTitle: 'Senior Software Engineer',
  seniority: 'senior',
  seniorityConfidence: 'high',
  requiredStack: ['TypeScript', 'Node.js'],
  niceToHaveStack: ['React'],
  industries: ['SaaS'],
  teamScope: 'Small team of 5',
  location: 'Remote',
  compensation: '$150k-$180k',
};

function makeToolUseResponse(input: object) {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'parse_job_description',
        input,
      },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'tool_use',
  };
}

describe('LLMService', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    _resetConfig();
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    _resetConfig();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('throws if API key is not configured', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      _resetConfig();
      expect(() => new LLMService()).toThrow('[llm] ANTHROPIC_API_KEY not configured');
    });

    it('constructs with default model', () => {
      expect(() => new LLMService()).not.toThrow();
    });

    it('constructs with custom model', () => {
      expect(() => new LLMService('claude-haiku-4-5')).not.toThrow();
    });
  });

  describe('parseJobDescription', () => {
    it('returns parsed job description on success', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce(makeToolUseResponse(PARSED_JD_FIXTURE));

      const service = new LLMService();
      const result = await service.parseJobDescription('We are hiring a Senior Software Engineer...');

      expect(result).toEqual(PARSED_JD_FIXTURE);
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('forces tool_use via tool_choice', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce(makeToolUseResponse(PARSED_JD_FIXTURE));

      const service = new LLMService();
      await service.parseJobDescription('Job description text');

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'parse_job_description' });
    });

    it('retries on failure and succeeds on second attempt', async () => {
      const mockCreate = await getMockCreate();
      mockCreate
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(makeToolUseResponse(PARSED_JD_FIXTURE));

      const service = new LLMService();
      const result = await service.parseJobDescription('Job description text');

      expect(result).toEqual(PARSED_JD_FIXTURE);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries are exhausted', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockRejectedValue(new Error('persistent error'));

      const service = new LLMService();
      await expect(service.parseJobDescription('Job description text')).rejects.toThrow('persistent error');
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('throws when response contains no tool_use block', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'some text' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const service = new LLMService();
      await expect(service.parseJobDescription('Job description text')).rejects.toThrow(
        '[llm] No tool_use block in response',
      );
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});
