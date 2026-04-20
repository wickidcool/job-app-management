import { promises as fs } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { resumes, resumeExports } from '../db/schema.js';
import { getConfig } from '../config.js';
import { NotFoundError, AppError } from '../types/index.js';

export interface ProjectMeta {
  id: string;
  name: string;
  fileCount: number;
  updatedAt: string;
}

export interface ProjectFileMeta {
  fileName: string;
  size: number;
  updatedAt: string;
}

function projectsDir(): string {
  return path.join(getConfig().dataDir, 'projects');
}

function safeJoin(base: string, ...parts: string[]): string {
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new AppError('INVALID_PATH', 'Path traversal detected', undefined, 400);
  }
  return resolved;
}

function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const dir = projectsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const projects: ProjectMeta[] = [];
  for (const entry of entries) {
    if (entry === 'index.md') continue;
    const entryPath = path.join(dir, entry);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const files = await fs.readdir(entryPath).catch(() => [] as string[]);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const mtimes = await Promise.all(
      mdFiles.map((f) => fs.stat(path.join(entryPath, f)).catch(() => null)),
    );
    const latest = mtimes.reduce<Date | null>((max, s) => {
      if (!s) return max;
      return !max || s.mtime > max ? s.mtime : max;
    }, null);

    projects.push({
      id: entry,
      name: slugToName(entry),
      fileCount: mdFiles.length,
      updatedAt: (latest ?? stat.mtime).toISOString(),
    });
  }

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listProjectFiles(projectId: string): Promise<ProjectFileMeta[]> {
  const dir = safeJoin(projectsDir(), projectId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    throw new NotFoundError('Project');
  }

  const result: ProjectFileMeta[] = [];
  for (const file of files.filter((f) => f.endsWith('.md'))) {
    const stat = await fs.stat(path.join(dir, file)).catch(() => null);
    if (!stat) continue;
    result.push({ fileName: file, size: stat.size, updatedAt: stat.mtime.toISOString() });
  }
  return result.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export async function getProjectFile(projectId: string, fileName: string): Promise<string> {
  if (!fileName.endsWith('.md')) {
    throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
  }
  const filePath = safeJoin(projectsDir(), projectId, fileName);
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new NotFoundError('Project file');
  }
}

export async function updateProjectFile(
  projectId: string,
  fileName: string,
  content: string,
): Promise<void> {
  if (!fileName.endsWith('.md')) {
    throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
  }
  const dir = safeJoin(projectsDir(), projectId);
  // Ensure directory exists (project must exist)
  try {
    await fs.access(dir);
  } catch {
    throw new NotFoundError('Project');
  }
  const filePath = safeJoin(dir, fileName);
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function deleteResume(resumeId: string): Promise<void> {
  const db = getDb();
  const [resume] = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1);
  if (!resume) throw new NotFoundError('Resume');

  // Delete resume file
  await fs.unlink(resume.filePath).catch(() => null);

  // Delete exports
  const exports = await db
    .select()
    .from(resumeExports)
    .where(eq(resumeExports.resumeId, resumeId));
  for (const exp of exports) {
    await fs.unlink(exp.filePath).catch(() => null);
  }
  await db.delete(resumeExports).where(eq(resumeExports.resumeId, resumeId));

  // Cascade delete per-project markdown files for this resume
  const dir = projectsDir();
  let projectDirs: string[] = [];
  try {
    projectDirs = await fs.readdir(dir);
  } catch {
    // no projects dir yet
  }
  for (const projectDir of projectDirs) {
    const projectPath = path.join(dir, projectDir);
    const stat = await fs.stat(projectPath).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const targetFile = path.join(projectPath, `resume-${resumeId}.md`);
    await fs.unlink(targetFile).catch(() => null);
    // Clean up empty project dirs
    const remaining = await fs.readdir(projectPath).catch(() => ['placeholder']);
    if (remaining.length === 0) {
      await fs.rmdir(projectPath).catch(() => null);
    }
  }

  await db.delete(resumes).where(eq(resumes.id, resumeId));
}

export async function generateProjectIndex(): Promise<{ path: string; projectCount: number }> {
  const projects = await listProjects();
  const dir = projectsDir();
  await fs.mkdir(dir, { recursive: true });

  const lines: string[] = [];
  lines.push('# Projects Index');
  lines.push('');
  lines.push(`> Auto-generated on ${new Date().toISOString()}. ${projects.length} project(s).`);
  lines.push('');

  for (const project of projects) {
    lines.push(`## ${project.name}`);
    lines.push('');
    lines.push(`- **ID:** ${project.id}`);
    lines.push(`- **Files:** ${project.fileCount}`);
    lines.push(`- **Last updated:** ${project.updatedAt}`);
    lines.push('');
    const files = await listProjectFiles(project.id).catch(() => [] as ProjectFileMeta[]);
    for (const file of files) {
      lines.push(`  - [${file.fileName}](${project.id}/${file.fileName})`);
    }
    lines.push('');
  }

  const indexPath = path.join(dir, 'index.md');
  await fs.writeFile(indexPath, lines.join('\n'), 'utf-8');

  return { path: 'projects/index.md', projectCount: projects.length };
}
