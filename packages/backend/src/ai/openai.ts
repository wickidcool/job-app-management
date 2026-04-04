import OpenAI from 'openai';
import type { AIProvider } from './interface.js';
import { UPDATE_PROJECT_SYSTEM_PROMPT, COVER_LETTER_SYSTEM_PROMPT, estimateTokens, MAX_TOKENS } from './prompts.js';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async updateProjectFile(content: string, instruction: string): Promise<string> {
    const userMessage = `Instruction: ${instruction}\n\nCurrent content:\n${content}`;
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: UPDATE_PROJECT_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });
    return response.choices[0]?.message?.content ?? content;
  }

  async generateCoverLetter(indexContent: string, jobDescription: string, additionalContext?: string): Promise<string> {
    let context = `Project Index:\n${indexContent}\n\nJob Description:\n${jobDescription}`;
    if (additionalContext) context += `\n\nAdditional Context:\n${additionalContext}`;
    if (estimateTokens(context) > MAX_TOKENS) {
      context = context.slice(0, MAX_TOKENS * 4);
    }
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: COVER_LETTER_SYSTEM_PROMPT },
        { role: 'user', content: context },
      ],
    });
    return response.choices[0]?.message?.content ?? '';
  }
}
