// Cloudflare Workers lacks canvas DOM APIs that pdfjs-dist references at module level.
// These stubs satisfy module initialization; they are never invoked during text-only
// PDF extraction (which uses no canvas rendering).
/* eslint-disable @typescript-eslint/no-explicit-any */
const _g = globalThis as any;
if (typeof _g.DOMMatrix === 'undefined') {
  _g.DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    scaleSelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
  };
}
if (typeof _g.ImageData === 'undefined') {
  _g.ImageData = class ImageData {};
}
if (typeof _g.Path2D === 'undefined') {
  _g.Path2D = class Path2D {
    constructor(_path?: unknown) {}
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

import { ulid } from 'ulid';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { resumes, resumeExports, companyCatalog } from '../db/schema.js';
import { getConfig } from '../config.js';
import {
  NotFoundError,
  ResumeDTO,
  ResumeExportDTO,
  UploadResumeResult,
  ParseDebugInfo,
} from '../types/index.js';
import {
  isR2Configured,
  isStorageAvailable,
  uploadObject,
  deleteObject,
  buildObjectKey,
} from './storage.service.js';
import { enqueueChange, flush } from './change-queue.service.js';
import {
  parseResumeWithAI,
  generateAIProjectMarkdown,
  isAIParserAvailable,
} from './ai-parser.service.js';
import { getOrCreateProjectBySlug } from './project.service.js';

export async function addCompanyToCatalog(companyName: string, userId?: string): Promise<void> {
  if (!companyName) return;
  const db = getDb();
  const normalized =
    companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unspecified';
  const [existing] = await db
    .select()
    .from(companyCatalog)
    .where(eq(companyCatalog.normalizedName, normalized));
  if (!existing) {
    await db
      .insert(companyCatalog)
      .values({
        id: ulid(),
        userId: userId ?? null,
        name: companyName,
        normalizedName: normalized,
        firstSeenAt: new Date(),
        applicationCount: 0,
        latestStatus: null,
        latestAppId: null,
      })
      .onConflictDoNothing();
  }
}

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
    // Pre-register the pdfjs worker inline so it doesn't try to spawn a Web Worker.
    // pdfjs checks globalThis.pdfjsWorker?.WorkerMessageHandler before attempting
    // to load a worker URL, so this enables its fake-worker (inline) mode.
    // Use the legacy build — the standard build emits a Node.js environment warning
    // and fails to extract text in Cloudflare Workers (nodejs_compat mode).
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — no type declaration for the build artifact
    const pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).pdfjsWorker = pdfjsWorker;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — no type declaration for the build artifact
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const loadingTask = getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      verbosity: 0,
    });

    type PdfjsTextItem = { str: string; transform: number[] };
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      // Group text items by y-coordinate to reconstruct visual lines.
      // pdfjs returns individual text runs; joining them all with spaces loses
      // newlines, which breaks section-heading detection in parseResumeText.
      const byLine = new Map<number, string[]>();
      const yOrder: number[] = [];
      for (const item of textContent.items) {
        if (!('str' in item)) continue;
        const raw = item as PdfjsTextItem;
        const str = raw.str;
        if (!str) continue;
        const y = Math.round(raw.transform[5]);
        if (!byLine.has(y)) {
          byLine.set(y, []);
          yOrder.push(y);
        }
        byLine.get(y)!.push(str);
      }
      // PDF y-axis increases bottom-up, so sort descending for top-to-bottom order.
      yOrder.sort((a, b) => b - a);
      const pageText = yOrder
        .map((y) => byLine.get(y)!.join(' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');
      pages.push(pageText);
      page.cleanup();
    }

    await pdf.destroy();
    return pages.join('\n');
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

  const SECTION_HEADINGS =
    /^(experience|work\s+experience|professional\s+experience|employment\s+history|work\s+history|career\s+history|education|skills|summary|objective|projects|certifications|awards|publications|references)/i;

  for (const line of lines) {
    // Normalize internal whitespace before testing — PDFs often produce "PROFESSIONAL  EXPERIENCE"
    const normalizedLine = line.replace(/\s+/g, ' ');
    if (SECTION_HEADINGS.test(normalizedLine) && normalizedLine.length < 60) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: normalizedLine, bullets: [] };
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
        const isEntry =
          !bullet.startsWith('-') && !bullet.startsWith('•') && !bullet.startsWith('*');
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
      const isEntry =
        !bullet.startsWith('-') &&
        !bullet.startsWith('•') &&
        !bullet.startsWith('*') &&
        !bullet.startsWith('·');

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
    lines.push(
      `**Role:** ${entry.role} | **Period:** ${entry.period} | **Industry:** _[Industry / sector]_`
    );
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

async function writeProjectFile(
  slug: string,
  fileName: string,
  content: string,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  if (isStorageAvailable()) {
    await uploadObject(`projects/${slug}/${fileName}`, content, 'text/markdown');
  } else {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const projectDir = path.join(config.dataDir, 'projects', slug);
    await fs.mkdir(projectDir, { recursive: true });
    const filePath = path.join(projectDir, fileName);
    if (!filePath.startsWith(projectDir)) {
      throw new Error('Invalid filename: path traversal detected');
    }
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

export async function uploadResume(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  userId?: string
): Promise<UploadResumeResult> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Only PDF and DOCX are accepted.`);
  }

  const config = getConfig();
  const resumeId = ulid();
  const ext = mimeType === 'application/pdf' ? '.pdf' : '.docx';
  const storedFileName = `${resumeId}${ext}`;

  let filePath: string;
  if (isStorageAvailable()) {
    filePath = buildObjectKey(userId ?? null, 'resumes', storedFileName);
    await uploadObject(filePath, fileBuffer, mimeType);
  } else {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const resumeDir = path.join(config.dataDir, 'resumes');
    await fs.mkdir(resumeDir, { recursive: true });
    filePath = path.join(resumeDir, storedFileName);
    await fs.writeFile(filePath, fileBuffer);
  }

  const db = getDb();
  const [resume] = await db
    .insert(resumes)
    .values({
      id: resumeId,
      userId: userId ?? null,
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

  let exportPath: string;
  if (isStorageAvailable()) {
    exportPath = buildObjectKey(userId ?? null, 'resume-exports', exportFileName);
    await uploadObject(exportPath, Buffer.from(starMarkdown, 'utf-8'), 'text/markdown');
  } else {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const resumeDir = path.join(config.dataDir, 'resumes');
    exportPath = path.join(resumeDir, exportFileName);
    await fs.writeFile(exportPath, starMarkdown, 'utf-8');
  }

  const sectionSummary = parsed.sections.map((s) => ({
    heading: s.heading,
    bulletCount: s.bullets.length,
  }));

  const [resumeExport] = await db
    .insert(resumeExports)
    .values({
      id: exportId,
      userId: userId ?? null,
      resumeId,
      exportType: 'star_markdown',
      filePath: exportPath,
      metadata: { sections: sectionSummary, charCount: rawText.length },
    })
    .returning();

  // Generate per-company/project markdown files under data/projects/{projectSlug}/
  // Projects are created as independent entities in the database
  // Try AI parsing first, fall back to heuristic parsing
  let usedAI = false;
  const aiAvailable = isAIParserAvailable();
  const companiesAddedToCatalog: string[] = [];
  let aiError: string | undefined;

  const sectionHeadings = parsed.sections.map((s) => s.heading);
  const rawLineCount = rawText.split('\n').filter((l) => l.trim().length > 0).length;
  console.log(
    `[resume] Upload: file="${fileName}" sections=${parsed.sections.length} headings=[${sectionHeadings.join(', ')}] rawTextLen=${rawText.length} lineCount=${rawLineCount} aiAvailable=${aiAvailable}`
  );

  if (aiAvailable) {
    let aiResult = null;
    try {
      aiResult = await parseResumeWithAI(rawText);
      console.log(`[resume] AI result: projects=${aiResult?.projects.length ?? 0}`);
    } catch (err) {
      aiError = err instanceof Error ? err.message : String(err);
      console.error('[resume] AI parse API call failed:', aiError);
    }

    if (aiResult && aiResult.projects.length > 0) {
      const safeBase = fileName
        .split(/[/\\]/)
        .pop()!
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_');

      for (const aiProject of aiResult.projects) {
        // Catalog write is always attempted — project file write is best-effort.
        // Separating them so an R2 write failure doesn't prevent catalog updates.
        try {
          const slug = toProjectSlug(aiProject.company) || resumeId;
          const project = await getOrCreateProjectBySlug(slug, aiProject.company, userId);
          await addCompanyToCatalog(aiProject.company, userId);
          companiesAddedToCatalog.push(aiProject.company);
          console.log(
            `[resume] AI: catalog updated company="${aiProject.company}" slug="${project.slug}"`
          );
          const projectMarkdown = generateAIProjectMarkdown(aiProject);
          await writeProjectFile(project.slug, `${safeBase}.md`, projectMarkdown, config);
        } catch (err) {
          console.error(
            `[resume] AI: failed to process company="${aiProject.company}":`,
            err instanceof Error ? err.message : err
          );
        }
      }
      usedAI = companiesAddedToCatalog.length > 0;
    } else if (!aiError) {
      console.log('[resume] AI returned 0 projects, falling back to heuristic');
    }
  } else {
    console.log(
      '[resume] AI parser not available — ANTHROPIC_API_KEY not set as Cloudflare Workers secret'
    );
  }

  const experienceEntries = extractExperienceEntries(parsed);
  console.log(
    `[resume] Heuristic experience entries: ${experienceEntries.length} — companies: [${experienceEntries.map((e) => e.company).join(', ')}]`
  );

  if (!usedAI) {
    if (experienceEntries.length === 0) {
      console.warn(
        '[resume] No experience entries extracted by heuristic parser. Check resume section headings match: experience|work experience|employment'
      );
    }
    for (const entry of experienceEntries) {
      const slug = toProjectSlug(entry.company) || resumeId;
      console.log(`[resume] Heuristic: processing company="${entry.company}" slug="${slug}"`);
      try {
        const project = await getOrCreateProjectBySlug(slug, entry.company, userId);
        await addCompanyToCatalog(entry.company, userId);
        companiesAddedToCatalog.push(entry.company);
        console.log(
          `[resume] Heuristic: catalog updated for company="${entry.company}" projectId="${project.id}"`
        );
        const projectMarkdown = generateProjectMarkdown(entry);
        const safeBase = fileName
          .split(/[/\\]/)
          .pop()!
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-zA-Z0-9._-]/g, '_');
        await writeProjectFile(project.slug, `${safeBase}.md`, projectMarkdown, config);
      } catch (err) {
        console.error(
          `[resume] Heuristic: failed to process company="${entry.company}":`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  console.log(
    `[resume] Upload complete: usedAI=${usedAI} companiesAdded=${companiesAddedToCatalog.length} [${companiesAddedToCatalog.join(', ')}]`
  );

  // Pass rawText and userId so extraction.service has full context without re-reading R2.
  enqueueChange('resume', resumeId, 'created', { rawText, userId: userId ?? null });
  // Flush immediately to process catalog changes before response.
  // The debounced timer won't survive in serverless environments.
  await flush();

  const education: string[] = [];
  const skills: string[] = [];
  for (const section of parsed.sections) {
    if (/education/i.test(section.heading)) {
      education.push(...section.bullets);
    } else if (/skills/i.test(section.heading)) {
      skills.push(...section.bullets);
    }
  }

  const parseDebug: ParseDebugInfo = {
    aiAvailable,
    usedAI,
    sectionCount: parsed.sections.length,
    sectionHeadings,
    experienceEntryCount: experienceEntries.length,
    companiesAddedToCatalog,
    ...(aiError ? { aiError } : {}),
  };

  return {
    resume: toDTO(resume),
    export: exportToDTO(resumeExport),
    experiences: experienceEntries.map((e) => ({
      company: e.company,
      role: e.role,
      period: e.period,
      bullets: e.bullets,
    })),
    education,
    skills,
    parseDebug,
  };
}

export async function listResumes(userId?: string): Promise<ResumeDTO[]> {
  const db = getDb();
  const whereClause = userId ? eq(resumes.userId, userId) : undefined;
  const allResumes = await db.select().from(resumes).where(whereClause).orderBy(resumes.uploadedAt);
  return allResumes.map(toDTO);
}

export async function listResumeExports(
  resumeId: string,
  userId?: string
): Promise<ResumeExportDTO[]> {
  const db = getDb();

  const resumeWhere = userId
    ? and(eq(resumes.id, resumeId), eq(resumes.userId, userId))
    : eq(resumes.id, resumeId);
  const resume = await db.select().from(resumes).where(resumeWhere).limit(1);
  if (resume.length === 0) {
    throw new NotFoundError('Resume');
  }

  const exports = await db.select().from(resumeExports).where(eq(resumeExports.resumeId, resumeId));

  return exports.map(exportToDTO);
}

export async function getResumeExport(
  resumeId: string,
  exportId: string,
  userId?: string
): Promise<ResumeExportDTO> {
  const db = getDb();

  const resumeWhere = userId
    ? and(eq(resumes.id, resumeId), eq(resumes.userId, userId))
    : eq(resumes.id, resumeId);
  const resume = await db.select().from(resumes).where(resumeWhere).limit(1);
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

export async function deleteResume(resumeId: string, userId?: string): Promise<void> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(resumes.id, resumeId), eq(resumes.userId, userId))
    : eq(resumes.id, resumeId);
  const [resume] = await db.select().from(resumes).where(whereClause).limit(1);
  if (!resume) throw new NotFoundError('Resume');

  if (isStorageAvailable()) {
    await deleteObject(resume.filePath).catch(() => null);
  } else {
    const { promises: fs } = await import('node:fs');
    await fs.unlink(resume.filePath).catch(() => null);
  }

  const exports = await db.select().from(resumeExports).where(eq(resumeExports.resumeId, resumeId));
  for (const exp of exports) {
    if (isStorageAvailable()) {
      await deleteObject(exp.filePath).catch(() => null);
    } else {
      const { promises: fs } = await import('node:fs');
      await fs.unlink(exp.filePath).catch(() => null);
    }
  }

  await db.delete(resumes).where(eq(resumes.id, resumeId));
}

export async function getResumeDownloadUrl(
  resumeId: string,
  userId?: string
): Promise<{ url: string; expiresAt: string }> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(resumes.id, resumeId), eq(resumes.userId, userId))
    : eq(resumes.id, resumeId);
  const [resume] = await db.select().from(resumes).where(whereClause).limit(1);
  if (!resume) throw new NotFoundError('Resume');

  const { getSignedUrl } = await import('./storage.service.js');
  const expiresInSeconds = 3600;
  const url = await getSignedUrl(resume.filePath, expiresInSeconds);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  return { url, expiresAt };
}
