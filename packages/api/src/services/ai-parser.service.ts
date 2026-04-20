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

const PARSE_PROMPT = `You are an expert resume parser. Extract structured project/experience data from the resume text below.

For each job/project, identify:
- Company name
- Role/title
- Time period
- Industry/sector
- Technologies used
- Key accomplishments in STAR format (Situation, Task, Action, Result)

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
- Extract real data from the resume, do not invent information
- If a field is unclear, use a reasonable inference or leave empty string
- For accomplishments, try to infer STAR components even if not explicitly stated
- Quantify results where possible (%, $, time saved, users impacted)
- Technologies should be specific (not just "programming" but "Python", "React", etc.)

Resume text:
`;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;

  const config = getConfig();
  if (!config.anthropicApiKey) return null;

  client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

export function isAIParserAvailable(): boolean {
  return getClient() !== null;
}

export async function parseResumeWithAI(rawText: string): Promise<AIParseResult | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: PARSE_PROMPT + rawText,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return null;

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]) as AIParseResult;
  return parsed;
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
