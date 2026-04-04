import type { AIProvider } from './interface.js';
import { StubAIProvider } from './stub.js';
import { AnthropicAIProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

interface AIConfig {
  AI_PROVIDER?: string;
  AI_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_MODEL?: string;
}

export function createAIProvider(config: AIConfig): AIProvider {
  const provider = config.AI_PROVIDER;
  if (!provider) {
    throw new Error('AI_PROVIDER is required. Valid values: anthropic, openai, stub');
  }
  if (provider === 'stub') {
    return new StubAIProvider();
  }
  if (provider === 'anthropic') {
    if (!config.AI_API_KEY) throw new Error('API key (AI_API_KEY) is required for Anthropic provider');
    return new AnthropicAIProvider(config.AI_API_KEY, config.ANTHROPIC_MODEL);
  }
  if (provider === 'openai') {
    if (!config.AI_API_KEY) throw new Error('API key (AI_API_KEY) is required for OpenAI provider');
    return new OpenAIProvider(config.AI_API_KEY, config.OPENAI_MODEL);
  }
  throw new Error(`Unknown AI_PROVIDER: "${provider}". Valid values: anthropic, openai, stub`);
}
