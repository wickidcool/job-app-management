import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider } from './interface.js';
import { UPDATE_PROJECT_SYSTEM_PROMPT, COVER_LETTER_SYSTEM_PROMPT, estimateTokens, MAX_TOKENS } from './prompts.js';

export class AnthropicAIProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-3-5-haiku-20241022') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async updateProjectFile(content: string, instruction: string): Promise<string> {
    const userMessage = `Instruction: ${instruction}\n\nCurrent content:\n${content}`;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: UPDATE_PROJECT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : content;
  }

  async generateCoverLetter(indexContent: string, jobDescription: string, additionalContext?: string): Promise<string> {
    let context = `Project Index:\n${indexContent}\n\nJob Description:\n${jobDescription}`;
    if (additionalContext) context += `\n\nAdditional Context:\n${additionalContext}`;
    if (estimateTokens(context) > MAX_TOKENS) {
      context = context.slice(0, MAX_TOKENS * 4);
    }
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: COVER_LETTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }
}
