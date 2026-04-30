import { z } from 'zod';
import {
  getOrCreateProjectBySlug,
  getProjectFile,
  updateProjectFile,
  createProjectFile,
  toSlug,
} from './project.service.js';
import { ConflictError } from '../types/index.js';

export const AccomplishmentSchema = z.object({
  title: z.string().min(1, 'title is required'),
  situation: z.string().min(1, 'situation is required'),
  task: z.string().min(1, 'task is required'),
  action: z.string().min(1, 'action is required'),
  result: z.string().min(1, 'result is required'),
  technologies: z.array(z.string()).default([]),
});

export const ProjectCaptureSchema = z.object({
  company: z.string().min(1, 'company is required'),
  role: z.string().min(1, 'role is required'),
  period: z.string().min(1, 'period is required'),
  industry: z.string().min(1, 'industry is required'),
  technologies: z.array(z.string()).default([]),
  jobFit: z.array(z.string()).default([]),
  accomplishments: z.array(AccomplishmentSchema).min(1, 'at least one accomplishment is required'),
});

export const ProjectEnrichSchema = z.object({
  company: z.string().optional(),
  role: z.string().optional(),
  period: z.string().optional(),
  industry: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  jobFit: z.array(z.string()).optional(),
  accomplishments: z.array(AccomplishmentSchema).optional(),
});

export type AccomplishmentInput = z.infer<typeof AccomplishmentSchema>;
export type ProjectCaptureInput = z.infer<typeof ProjectCaptureSchema>;
export type ProjectEnrichInput = z.infer<typeof ProjectEnrichSchema>;

export interface CaptureResult {
  slug: string;
  fileName: string;
  content: string;
}

export function generateDialogueMarkdown(data: ProjectCaptureInput): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`company: ${data.company}`);
  if (data.role) lines.push(`role: ${data.role}`);
  if (data.period) lines.push(`period: ${data.period}`);
  lines.push(`industry: ${data.industry || '_[Industry / sector]_'}`);
  lines.push(`tech: [${data.technologies.map((t) => `"${t}"`).join(', ')}]`);
  lines.push(`job_fit: [${data.jobFit.map((j) => `"${j}"`).join(', ')}]`);
  lines.push('tags: [star, dialogue, interview, prep]');
  lines.push('---');
  lines.push('');

  const title = `${data.company} — ${data.role}`;
  lines.push(`# ${title}`);
  lines.push(
    `**Role:** ${data.role} | **Period:** ${data.period} | **Industry:** ${data.industry || '_[Industry]_'}`
  );
  lines.push('');

  if (data.technologies.length > 0) {
    lines.push(`**Tech Stack:** ${data.technologies.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  for (const acc of data.accomplishments) {
    lines.push(`## ⭐ ${acc.title}`);
    if (acc.technologies.length > 0) {
      lines.push(`**Tech:** ${acc.technologies.join(', ')}`);
    }
    lines.push('');
    lines.push('| | |');
    lines.push('|---|---|');
    lines.push(`| **Situation** | ${acc.situation} |`);
    lines.push(`| **Task** | ${acc.task} |`);
    lines.push(`| **Action** | ${acc.action} |`);
    lines.push(`| **Result** | ${acc.result} |`);
    lines.push('');
  }

  return lines.join('\n');
}

function generateFileName(company: string, role: string): string {
  return `${toSlug(company)}-${toSlug(role)}.md`;
}

function parseFrontmatterField(fm: string, key: string): string {
  return fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
}

function parseFrontmatterArray(fm: string, key: string): string[] {
  const line = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'))?.[1] ?? '';
  if (!line.trim()) return [];
  return line
    .split(',')
    .map((t) => t.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function extractAccomplishments(content: string): AccomplishmentInput[] {
  const result: AccomplishmentInput[] = [];
  const sections = content.split(/^## ⭐ /m).slice(1);

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0]?.trim() ?? '';
    if (!title) continue;

    const situation = section.match(/\| \*\*Situation\*\* \| (.+?) \|/)?.[1]?.trim() ?? '';
    const task = section.match(/\| \*\*Task\*\* \| (.+?) \|/)?.[1]?.trim() ?? '';
    const action = section.match(/\| \*\*Action\*\* \| (.+?) \|/)?.[1]?.trim() ?? '';
    const resultText = section.match(/\| \*\*Result\*\* \| (.+?) \|/)?.[1]?.trim() ?? '';
    const techMatch = section.match(/\*\*Tech:\*\* (.+)/);
    const technologies = techMatch
      ? techMatch[1]
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    result.push({ title, situation, task, action, result: resultText, technologies });
  }

  return result;
}

function parseExistingFile(content: string): ProjectCaptureInput {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return {
      company: '',
      role: '',
      period: '',
      industry: '',
      technologies: [],
      jobFit: [],
      accomplishments: [],
    };
  }

  const fm = fmMatch[1];
  return {
    company: parseFrontmatterField(fm, 'company'),
    role: parseFrontmatterField(fm, 'role'),
    period: parseFrontmatterField(fm, 'period'),
    industry: parseFrontmatterField(fm, 'industry'),
    technologies: parseFrontmatterArray(fm, 'tech'),
    jobFit: parseFrontmatterArray(fm, 'job_fit'),
    accomplishments: extractAccomplishments(content),
  };
}

function mergeProjectData(
  existing: ProjectCaptureInput,
  additions: ProjectEnrichInput
): ProjectCaptureInput {
  return {
    company: additions.company || existing.company,
    role: additions.role || existing.role,
    period: additions.period || existing.period,
    industry: additions.industry || existing.industry,
    technologies:
      additions.technologies !== undefined
        ? [...new Set([...existing.technologies, ...additions.technologies])]
        : existing.technologies,
    jobFit:
      additions.jobFit !== undefined
        ? [...new Set([...existing.jobFit, ...additions.jobFit])]
        : existing.jobFit,
    accomplishments: additions.accomplishments
      ? [...existing.accomplishments, ...additions.accomplishments]
      : existing.accomplishments,
  };
}

export async function captureProjectFile(
  slug: string,
  data: ProjectCaptureInput,
  overrideFileName?: string,
  userId?: string
): Promise<CaptureResult> {
  await getOrCreateProjectBySlug(slug, data.company, userId);
  const fileName = overrideFileName ?? generateFileName(data.company, data.role);
  const content = generateDialogueMarkdown(data);
  try {
    await createProjectFile(slug, fileName, content, userId);
  } catch (err) {
    if (err instanceof ConflictError) throw err;
    throw err;
  }
  return { slug, fileName, content };
}

export async function enrichProjectFile(
  slug: string,
  fileName: string,
  additions: ProjectEnrichInput,
  userId?: string
): Promise<{ content: string }> {
  const existing = await getProjectFile(slug, fileName, userId);
  const parsed = parseExistingFile(existing);
  const merged = mergeProjectData(parsed, additions);
  const content = generateDialogueMarkdown(merged);
  await updateProjectFile(slug, fileName, content, userId);
  return { content };
}

export async function correctProjectFile(
  slug: string,
  fileName: string,
  data: ProjectCaptureInput,
  userId?: string
): Promise<{ content: string }> {
  await getProjectFile(slug, fileName, userId); // verify file exists
  const content = generateDialogueMarkdown(data);
  await updateProjectFile(slug, fileName, content, userId);
  return { content };
}
