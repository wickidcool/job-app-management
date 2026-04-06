export const UPDATE_PROJECT_SYSTEM_PROMPT = `You are a technical writer helping improve resume and portfolio content. Update the following project description as instructed. Return only the updated markdown content, preserving any existing frontmatter.`;

export const COVER_LETTER_SYSTEM_PROMPT = `You are a professional career coach helping write compelling cover letters. Write a concise, professional cover letter (3-4 paragraphs) based on the provided project index and job description. Do not include placeholder text — write a complete, ready-to-send letter.`;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const MAX_TOKENS = 8000;
