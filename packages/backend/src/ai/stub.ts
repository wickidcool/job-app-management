import type { AIProvider } from './interface.js';

export class StubAIProvider implements AIProvider {
  async updateProjectFile(content: string, instruction: string): Promise<string> {
    return `[AI STUB] Updated based on instruction: "${instruction}"\n\n${content}`;
  }

  async generateCoverLetter(_indexContent: string, jobDescription: string, _additionalContext?: string): Promise<string> {
    return `[AI STUB] Cover letter for job: "${jobDescription.slice(0, 100)}..."\n\nDear Hiring Manager,\n\nThis is a stub cover letter generated for testing purposes.\n\nSincerely,\nApplicant`;
  }
}
