import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';

export interface AIProject {
  company: string;
  role: string;
  period: string;
  industry: string;
  technologies: string[];
  accomplishments: AIAccomplishment[];
}

export interface AIAccomplishment {
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  technologies: string[];
}

export interface AIParseResult {
  projects: AIProject[];
  skills: string[];
  summary: string;
}

const PARSE_PROMPT = `Parse this resume and generate markdown file text in STAR format for each project or companies I have worked for. Pull out multiple STAR items based on the current bullet points. Do not make up situations.

For each job/project, identify:
- Company name
- Role/title
- Time period
- Industry/sector
- Technologies used
- Multiple STAR accomplishments derived from each bullet point in the resume

Output valid JSON matching this schema:
{
  "projects": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "period": "Jan 2020 - Dec 2022",
      "industry": "Technology/Finance/Healthcare/etc",
      "technologies": ["React", "Node.js", "AWS"],
      "accomplishments": [
        {
          "title": "Brief accomplishment title",
          "situation": "Context and challenge faced",
          "task": "Your specific responsibility",
          "action": "Steps you took",
          "result": "Quantified outcome with metrics",
          "technologies": ["React", "TypeScript"]
        }
      ]
    }
  ],
  "skills": ["TypeScript", "React", "AWS"],
  "summary": "Brief professional summary"
}

Rules:
- Do NOT make up situations - only extract what is stated or clearly implied in the resume
- Create a separate STAR accomplishment for each bullet point in the experience section
- If a field is unclear, leave it as an empty string rather than inventing information
- Quantify results where possible (%, $, time saved, users impacted) but only if the data is present
- Technologies should be specific (not just "programming" but "Python", "React", etc.)

Resume text:
`;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;

  const config = getConfig();
  if (!config.anthropicApiKey) {
    console.log('[ai-parser] ANTHROPIC_API_KEY not configured');
    return null;
  }

  const key = config.anthropicApiKey;
  // Log environment vs config key to check for conflicts
  const envKey = process.env.ANTHROPIC_API_KEY;
  console.log(`[ai-parser] Env key: ${envKey ? envKey.substring(0, 15) + '...' + envKey.substring(envKey.length - 4) : 'not set'} (len: ${envKey?.length ?? 0})`);
  console.log(`[ai-parser] Config key: ${key.substring(0, 15)}...${key.substring(key.length - 4)} (len: ${key.length})`);
  // Explicitly pass apiKey to override any env var the SDK might find
  client = new Anthropic({ apiKey: key });
  return client;
}

export function isAIParserAvailable(): boolean {
  return getClient() !== null;
}

export async function parseResumeWithAI(rawText: string): Promise<AIParseResult | null> {
  const anthropic = getClient();
  if (!anthropic) {
    console.log('[ai-parser] No Anthropic client available');
    return null;
  }

  console.log('[ai-parser] Sending resume to Claude API...');
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: PARSE_PROMPT + rawText,
      },
    ],
  });
  console.log(`[ai-parser] Claude API response received, stop_reason: ${response.stop_reason}`);
  console.log(`[ai-parser] Response content blocks: ${response.content.map((b) => b.type).join(', ')}`);
  
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    console.log('[ai-parser] No text block in Claude response');
    return null;
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('[ai-parser] Could not extract JSON from Claude response');
    console.log('[ai-parser] Response preview:', textBlock.text.substring(0, 500));
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as AIParseResult;
    console.log(`[ai-parser] Parsed ${parsed.projects?.length ?? 0} projects from response`);
    return parsed;
  } catch (parseError) {
    console.error('[ai-parser] Failed to parse JSON:', parseError);
    throw parseError;
  }
}

export function generateAIProjectMarkdown(project: AIProject): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`company: ${project.company}`);
  if (project.role) lines.push(`role: ${project.role}`);
  if (project.period) lines.push(`period: ${project.period}`);
  lines.push(`industry: ${project.industry || '_[Industry / sector]_'}`);
  lines.push(`tech: [${project.technologies.map((t) => `"${t}"`).join(', ')}]`);
  lines.push('job_fit: []');
  lines.push('tags: [star, resume, interview, prep, ai-parsed]');
  lines.push('---');
  lines.push('');

  const title = project.role ? `${project.company} — ${project.role}` : project.company;
  lines.push(`# ${title}`);
  if (project.role && project.period) {
    lines.push(
      `**Role:** ${project.role} | **Period:** ${project.period} | **Industry:** ${project.industry || '_[Industry]_'}`,
    );
  }
  lines.push('');

  if (project.technologies.length > 0) {
    lines.push(`**Tech Stack:** ${project.technologies.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  if (project.accomplishments.length > 0) {
    for (const acc of project.accomplishments) {
      lines.push(`## ⭐ ${acc.title}`);
      if (acc.technologies.length > 0) {
        lines.push(`**Tech:** ${acc.technologies.join(', ')}`);
      }
      lines.push('');
      lines.push('| | |');
      lines.push('|---|---|');
      lines.push(`| **Situation** | ${acc.situation || '_[Describe the context]_'} |`);
      lines.push(`| **Task** | ${acc.task || '_[Describe your responsibility]_'} |`);
      lines.push(`| **Action** | ${acc.action || '_[Describe the steps you took]_'} |`);
      lines.push(`| **Result** | ${acc.result || '_[Quantify the outcome]_'} |`);
      lines.push('');
    }
  } else {
    lines.push('## ⭐ Key Accomplishments');
    lines.push('');
    lines.push('| | |');
    lines.push('|---|---|');
    lines.push('| **Situation** | _[Describe the context and company challenge]_ |');
    lines.push('| **Task** | _[Describe your responsibility]_ |');
    lines.push('| **Action** | _[Describe the specific steps you took]_ |');
    lines.push('| **Result** | _[Quantify the outcome: metrics, impact, improvements]_ |');
  }

  return lines.join('\n');
}
