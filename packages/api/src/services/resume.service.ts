import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { resumes, resumeExports } from '../db/schema.js';
import { getConfig } from '../config.js';
import { NotFoundError, ResumeDTO, ResumeExportDTO, UploadResumeResult } from '../types/index.js';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export interface ParsedSection {
  heading: string;
  bullets: string[];
}

export interface ParsedResume {
  rawText: string;
  sections: ParsedSection[];
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error(`Unsupported mime type: ${mimeType}`);
}

export function parseResumeText(rawText: string): ParsedResume {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  const SECTION_HEADINGS = /^(experience|work experience|employment|education|skills|summary|objective|projects|certifications|awards|publications|references)/i;

  for (const line of lines) {
    if (SECTION_HEADINGS.test(line) && line.length < 60) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: line, bullets: [] };
    } else if (currentSection) {
      currentSection.bullets.push(line);
    } else {
      if (!currentSection) {
        currentSection = { heading: 'Header', bullets: [] };
      }
      currentSection.bullets.push(line);
    }
  }

  if (currentSection) sections.push(currentSection);

  return { rawText, sections };
}

export function generateStarMarkdown(parsed: ParsedResume, fileName: string): string {
  const lines: string[] = [];
  lines.push(`# Resume Export: ${fileName}`);
  lines.push('');
  lines.push('> Generated STAR-format export. Review and expand each entry with specific details.');
  lines.push('');

  for (const section of parsed.sections) {
    lines.push(`## ${section.heading}`);
    lines.push('');

    const isExperience = /experience|employment|work/i.test(section.heading);

    if (isExperience && section.bullets.length > 0) {
      let i = 0;
      while (i < section.bullets.length) {
        const bullet = section.bullets[i];
        // Heuristic: lines that look like a job title/company entry (no leading dash/bullet)
        const isEntry = !bullet.startsWith('-') && !bullet.startsWith('•') && !bullet.startsWith('*');
        if (isEntry) {
          lines.push(`### ${bullet}`);
          lines.push('');
          lines.push('**Situation:** _[Describe the context, team size, or company challenge]_');
          lines.push('');
          lines.push('**Task:** _[Describe your responsibility or ownership in this role]_');
          lines.push('');

          // Collect sub-bullets as action items
          const actionBullets: string[] = [];
          i++;
          while (
            i < section.bullets.length &&
            (section.bullets[i].startsWith('-') ||
              section.bullets[i].startsWith('•') ||
              section.bullets[i].startsWith('*') ||
              section.bullets[i].startsWith('·'))
          ) {
            actionBullets.push(section.bullets[i].replace(/^[-•*·]\s*/, ''));
            i++;
          }

          if (actionBullets.length > 0) {
            lines.push('**Action:**');
            lines.push('');
            for (const ab of actionBullets) {
              lines.push(`- ${ab}`);
            }
          } else {
            lines.push('**Action:** _[Describe the specific steps you took]_');
          }
          lines.push('');
          lines.push('**Result:** _[Quantify the outcome: metrics, impact, improvements]_');
          lines.push('');
        } else {
          lines.push(`- ${bullet.replace(/^[-•*·]\s*/, '')}`);
          i++;
        }
      }
    } else {
      for (const bullet of section.bullets) {
        lines.push(`- ${bullet.replace(/^[-•*·]\s*/, '')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export interface ExperienceEntry {
  company: string;
  role: string;
  period: string;
  bullets: string[];
}

export function extractExperienceEntries(parsed: ParsedResume): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];

  for (const section of parsed.sections) {
    if (!/experience|employment|work/i.test(section.heading)) continue;

    let currentEntry: ExperienceEntry | null = null;

    for (const bullet of section.bullets) {
      const isEntry = !bullet.startsWith('-') && !bullet.startsWith('•') && !bullet.startsWith('*') && !bullet.startsWith('·');

      if (isEntry) {
        if (currentEntry) entries.push(currentEntry);
        const parts = bullet.split(/\s*[|–—]\s*/);
        currentEntry = {
          company: parts[0]?.trim() || bullet,
          role: parts[1]?.trim() || '',
          period: parts[2]?.trim() || '',
          bullets: [],
        };
      } else if (currentEntry) {
        currentEntry.bullets.push(bullet.replace(/^[-•*·]\s*/, ''));
      }
    }

    if (currentEntry) entries.push(currentEntry);
  }

  return entries;
}

export function toProjectSlug(company: string): string {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function generateProjectMarkdown(entry: ExperienceEntry): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`company: ${entry.company}`);
  if (entry.role) lines.push(`role: ${entry.role}`);
  if (entry.period) lines.push(`period: ${entry.period}`);
  lines.push('industry: _[Industry / sector]_');
  lines.push('tech: []');
  lines.push('job_fit: []');
  lines.push('tags: [star, resume, interview, prep]');
  lines.push('---');
  lines.push('');

  const title = entry.role ? `${entry.company} — ${entry.role}` : entry.company;
  lines.push(`# ${title}`);
  if (entry.role && entry.period) {
    lines.push(`**Role:** ${entry.role} | **Period:** ${entry.period} | **Industry:** _[Industry / sector]_`);
  }
  lines.push('');

  if (entry.bullets.length > 0) {
    lines.push('---');
    lines.push('');
    entry.bullets.forEach((b) => {
      lines.push(`## ⭐ ${b}`);
      lines.push('**Tech:** _[List relevant technologies]_');
      lines.push('');
      lines.push('| | |');
      lines.push('|---|---|');
      lines.push('| **Situation** | _[Describe the context and company challenge]_ |');
      lines.push('| **Task** | _[Describe your responsibility]_ |');
      lines.push(`| **Action** | ${b} |`);
      lines.push('| **Result** | _[Quantify the outcome: metrics, impact, improvements]_ |');
      lines.push('');
    });
  } else {
    lines.push('---');
    lines.push('');
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

function toDTO(r: typeof resumes.$inferSelect): ResumeDTO {
  return {
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    uploadedAt: r.uploadedAt.toISOString(),
    version: r.version,
  };
}

function exportToDTO(e: typeof resumeExports.$inferSelect): ResumeExportDTO {
  return {
    id: e.id,
    resumeId: e.resumeId,
    exportType: e.exportType,
    filePath: e.filePath,
    generatedAt: e.generatedAt.toISOString(),
    metadata: e.metadata as Record<string, unknown> | null,
  };
}

export async function uploadResume(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<UploadResumeResult> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Only PDF and DOCX are accepted.`);
  }

  const config = getConfig();
  const resumeDir = path.join(config.dataDir, 'resumes');
  await fs.mkdir(resumeDir, { recursive: true });

  const resumeId = ulid();
  const ext = mimeType === 'application/pdf' ? '.pdf' : '.docx';
  const storedFileName = `${resumeId}${ext}`;
  const filePath = path.join(resumeDir, storedFileName);
  await fs.writeFile(filePath, fileBuffer);

  const db = getDb();
  const [resume] = await db
    .insert(resumes)
    .values({
      id: resumeId,
      fileName,
      fileSize: fileBuffer.length,
      mimeType,
      filePath,
    })
    .returning();

  // Parse and generate STAR export
  const rawText = await extractText(fileBuffer, mimeType);
  const parsed = parseResumeText(rawText);
  const starMarkdown = generateStarMarkdown(parsed, fileName);

  const exportId = ulid();
  const exportFileName = `${exportId}_star.md`;
  const exportPath = path.join(resumeDir, exportFileName);
  await fs.writeFile(exportPath, starMarkdown, 'utf-8');

  const sectionSummary = parsed.sections.map((s) => ({
    heading: s.heading,
    bulletCount: s.bullets.length,
  }));

  const [resumeExport] = await db
    .insert(resumeExports)
    .values({
      id: exportId,
      resumeId,
      exportType: 'star_markdown',
      filePath: exportPath,
      metadata: { sections: sectionSummary, charCount: rawText.length },
    })
    .returning();

  // Generate per-company/project markdown files under data/projects/{projectId}/
  const experienceEntries = extractExperienceEntries(parsed);
  for (const entry of experienceEntries) {
    const projectId = toProjectSlug(entry.company) || resumeId;
    const projectDir = path.join(config.dataDir, 'projects', projectId);
    await fs.mkdir(projectDir, { recursive: true });
    const projectMarkdown = generateProjectMarkdown(entry);
    await fs.writeFile(path.join(projectDir, `resume-${resumeId}.md`), projectMarkdown, 'utf-8');
  }

  return {
    resume: toDTO(resume),
    export: exportToDTO(resumeExport),
  };
}

export async function listResumes(): Promise<ResumeDTO[]> {
  const db = getDb();
  const allResumes = await db.select().from(resumes).orderBy(resumes.uploadedAt);
  return allResumes.map(toDTO);
}

export async function listResumeExports(resumeId: string): Promise<ResumeExportDTO[]> {
  const db = getDb();

  const resume = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1);
  if (resume.length === 0) {
    throw new NotFoundError('Resume');
  }

  const exports = await db
    .select()
    .from(resumeExports)
    .where(eq(resumeExports.resumeId, resumeId));

  return exports.map(exportToDTO);
}

export async function getResumeExport(resumeId: string, exportId: string): Promise<ResumeExportDTO> {
  const db = getDb();

  const resume = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1);
  if (resume.length === 0) {
    throw new NotFoundError('Resume');
  }

  const [exp] = await db
    .select()
    .from(resumeExports)
    .where(eq(resumeExports.id, exportId))
    .limit(1);

  if (!exp || exp.resumeId !== resumeId) {
    throw new NotFoundError('Resume export');
  }

  return exportToDTO(exp);
}
