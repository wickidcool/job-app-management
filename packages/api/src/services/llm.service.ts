import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';
import type { ParsedJD } from './job-fit.service.js';

const MAX_RETRIES = 3;

const PARSE_JD_TOOL: Anthropic.Tool = {
  name: 'parse_job_description',
  description: 'Extract structured information from a job description text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      roleTitle: {
        type: ['string', 'null'],
        description: 'The job title or role name, or null if not specified.',
      },
      seniority: {
        type: ['string', 'null'],
        enum: [null, 'entry', 'mid', 'senior', 'staff', 'principal', 'director', 'vp', 'c_level'],
        description: 'Seniority level of the role, or null if unclear.',
      },
      seniorityConfidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Confidence in the seniority assessment.',
      },
      requiredStack: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technologies, languages, or frameworks explicitly required.',
      },
      niceToHaveStack: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technologies, languages, or frameworks listed as nice-to-have or preferred.',
      },
      industries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Industries or domains mentioned in the job description.',
      },
      teamScope: {
        type: ['string', 'null'],
        description: 'Description of team size or reporting structure, or null if not mentioned.',
      },
      location: {
        type: ['string', 'null'],
        description: 'Location or remote/hybrid/onsite status, or null if not specified.',
      },
      compensation: {
        type: ['string', 'null'],
        description: 'Salary range or compensation details, or null if not mentioned.',
      },
    },
    required: [
      'roleTitle',
      'seniority',
      'seniorityConfidence',
      'requiredStack',
      'niceToHaveStack',
      'industries',
      'teamScope',
      'location',
      'compensation',
    ],
  },
};

export class LLMService {
  private client: Anthropic;
  private model: string;

  constructor(model?: string) {
    const config = getConfig();
    if (!config.anthropicApiKey) {
      throw new Error('[llm] ANTHROPIC_API_KEY not configured');
    }
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.model = model ?? config.llmModel;
  }

  async parseJobDescription(text: string): Promise<ParsedJD> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          tools: [PARSE_JD_TOOL],
          tool_choice: { type: 'tool', name: 'parse_job_description' },
          messages: [
            {
              role: 'user',
              content: `Parse the following job description and extract structured information:\n\n${text}`,
            },
          ],
        });

        console.log(
          `[llm] parseJobDescription attempt=${attempt + 1} input_tokens=${response.usage.input_tokens} output_tokens=${response.usage.output_tokens}`
        );

        const toolUse = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );
        if (!toolUse) {
          throw new Error('[llm] No tool_use block in response');
        }

        return toolUse.input as ParsedJD;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(
          `[llm] parseJobDescription attempt=${attempt + 1} failed: ${lastError.message}`
        );
      }
    }

    throw lastError ?? new Error('[llm] parseJobDescription failed after retries');
  }
}
