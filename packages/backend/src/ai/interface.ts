export interface AIProvider {
  updateProjectFile(content: string, instruction: string): Promise<string>;
  generateCoverLetter(indexContent: string, jobDescription: string, additionalContext?: string): Promise<string>;
}
