import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ulid } from 'ulid';
import { eq, desc, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projects } from '../db/schema.js';
import { getConfig } from '../config.js';
import { NotFoundError, AppError, ConflictError } from '../types/index.js';

export interface ProjectMeta {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProjectFileMeta {
  fileName: string;
  size: number;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  description?: string;
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

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getFileCount(slug: string): Promise<number> {
  const dir = safeJoin(projectsDir(), slug);
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

export async function createProject(
  input: CreateProjectInput,
  userId?: string
): Promise<ProjectMeta> {
  const db = getDb();
  const slug = input.slug || toSlug(input.name);

  if (!slug) {
    throw new AppError(
      'BAD_REQUEST',
      'Project name must contain alphanumeric characters',
      undefined,
      400
    );
  }

  const existing = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (existing.length > 0) {
    throw new ConflictError('Project with this slug already exists');
  }

  const id = ulid();
  const dir = safeJoin(projectsDir(), slug);
  await fs.mkdir(dir, { recursive: true });

  const [project] = await db
    .insert(projects)
    .values({
      id,
      userId: userId ?? null,
      name: input.name,
      slug,
      description: input.description || null,
    })
    .returning();

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    fileCount: 0,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    version: project.version,
  };
}

export async function getProject(projectId: string): Promise<ProjectMeta> {
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

  if (!project) {
    throw new NotFoundError('Project');
  }

  const fileCount = await getFileCount(project.slug);

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    fileCount,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    version: project.version,
  };
}

export async function getProjectBySlug(slug: string, userId?: string): Promise<ProjectMeta> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(projects.slug, slug), eq(projects.userId, userId))
    : eq(projects.slug, slug);
  const [project] = await db.select().from(projects).where(whereClause).limit(1);

  if (project) {
    const fileCount = await getFileCount(project.slug);
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      fileCount,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      version: project.version,
    };
  }

  // Fallback to filesystem-only project
  const dir = safeJoin(projectsDir(), slug);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new NotFoundError('Project');
  }

  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  const mtimes = await Promise.all(
    mdFiles.map((f) => fs.stat(path.join(dir, f)).catch(() => null))
  );
  const latest = mtimes.reduce<Date | null>((max, s) => {
    if (!s) return max;
    return !max || s.mtime > max ? s.mtime : max;
  }, null);

  return {
    id: slug,
    name: slugToName(slug),
    slug,
    description: null,
    fileCount: mdFiles.length,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: (latest ?? stat.mtime).toISOString(),
    version: 1,
  };
}

function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function listProjects(userId?: string): Promise<ProjectMeta[]> {
  const db = getDb();
  const dir = projectsDir();

  // Get projects from database
  const dbProjects = await db
    .select()
    .from(projects)
    .where(userId ? eq(projects.userId, userId) : undefined)
    .orderBy(desc(projects.updatedAt));

  const dbSlugs = new Set(dbProjects.map((p) => p.slug));
  const result: ProjectMeta[] = [];

  // Add database projects
  for (const project of dbProjects) {
    const fileCount = await getFileCount(project.slug);
    result.push({
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      fileCount,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      version: project.version,
    });
  }

  // Discover filesystem-only projects (backwards compatibility)
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // No projects directory yet
  }

  for (const entry of entries) {
    if (entry === 'index.md' || dbSlugs.has(entry)) continue;
    const entryPath = path.join(dir, entry);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const files = await fs.readdir(entryPath).catch(() => [] as string[]);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    if (mdFiles.length === 0) continue;

    const mtimes = await Promise.all(
      mdFiles.map((f) => fs.stat(path.join(entryPath, f)).catch(() => null))
    );
    const latest = mtimes.reduce<Date | null>((max, s) => {
      if (!s) return max;
      return !max || s.mtime > max ? s.mtime : max;
    }, null);

    result.push({
      id: entry,
      name: slugToName(entry),
      slug: entry,
      description: null,
      fileCount: mdFiles.length,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: (latest ?? stat.mtime).toISOString(),
      version: 1,
    });
  }

  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(projectId: string, userId?: string): Promise<void> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(projects.id, projectId), eq(projects.userId, userId))
    : eq(projects.id, projectId);
  const [project] = await db.select().from(projects).where(whereClause).limit(1);

  if (!project) {
    throw new NotFoundError('Project');
  }

  const dir = safeJoin(projectsDir(), project.slug);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
  await db.delete(projects).where(whereClause);
}

export async function listProjectFiles(slug: string, userId?: string): Promise<ProjectFileMeta[]> {
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }
  const dir = safeJoin(projectsDir(), slug);
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

export async function getProjectFile(
  slug: string,
  fileName: string,
  userId?: string
): Promise<string> {
  if (!fileName.endsWith('.md')) {
    throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
  }
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }
  const filePath = safeJoin(projectsDir(), slug, fileName);
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new NotFoundError('Project file');
  }
}

export async function updateProjectFile(
  slug: string,
  fileName: string,
  content: string,
  userId?: string
): Promise<void> {
  if (!fileName.endsWith('.md')) {
    throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
  }
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }
  const dir = safeJoin(projectsDir(), slug);
  try {
    await fs.access(dir);
  } catch {
    throw new NotFoundError('Project');
  }
  const filePath = safeJoin(dir, fileName);
  await fs.writeFile(filePath, content, 'utf-8');

  // Update project's updatedAt timestamp
  const db = getDb();
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.slug, slug));
}

export async function createProjectFile(
  slug: string,
  fileName: string,
  content: string,
  userId?: string
): Promise<void> {
  if (!fileName.endsWith('.md')) {
    throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
  }
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }
  const dir = safeJoin(projectsDir(), slug);
  try {
    await fs.access(dir);
  } catch {
    throw new NotFoundError('Project');
  }
  const filePath = safeJoin(dir, fileName);

  // Check if file already exists
  try {
    await fs.access(filePath);
    throw new ConflictError('File already exists');
  } catch (err) {
    if (err instanceof ConflictError) throw err;
  }

  await fs.writeFile(filePath, content, 'utf-8');

  // Update project's updatedAt timestamp
  const db = getDb();
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.slug, slug));
}

export async function deleteProjectFile(
  slug: string,
  fileName: string,
  userId?: string
): Promise<void> {
  if (!fileName.endsWith('.md')) {
    throw new AppError('BAD_REQUEST', 'Only .md files are supported', undefined, 400);
  }
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }
  const filePath = safeJoin(projectsDir(), slug, fileName);
  try {
    await fs.unlink(filePath);
  } catch {
    throw new NotFoundError('Project file');
  }

  // Update project's updatedAt timestamp
  const db = getDb();
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.slug, slug));
}

export async function generateProjectIndex(
  userId?: string
): Promise<{ path: string; projectCount: number }> {
  const allProjects = await listProjects(userId);
  const dir = projectsDir();
  await fs.mkdir(dir, { recursive: true });

  const lines: string[] = [];
  lines.push('# Projects Index');
  lines.push('');
  lines.push(`> Auto-generated on ${new Date().toISOString()}. ${allProjects.length} project(s).`);
  lines.push('');

  for (const project of allProjects) {
    lines.push(`## ${project.name}`);
    lines.push('');
    lines.push(`- **Slug:** ${project.slug}`);
    lines.push(`- **Files:** ${project.fileCount}`);
    lines.push(`- **Last updated:** ${project.updatedAt}`);
    lines.push('');
    const files = await listProjectFiles(project.slug).catch(() => [] as ProjectFileMeta[]);
    for (const file of files) {
      lines.push(`  - [${file.fileName}](${project.slug}/${file.fileName})`);
    }
    lines.push('');
  }

  const indexPath = path.join(dir, 'index.md');
  await fs.writeFile(indexPath, lines.join('\n'), 'utf-8');

  return { path: 'projects/index.md', projectCount: allProjects.length };
}

export async function getOrCreateProjectBySlug(
  slug: string,
  name?: string,
  userId?: string
): Promise<ProjectMeta> {
  const db = getDb();
  const [existing] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

  if (existing) {
    const fileCount = await getFileCount(existing.slug);
    return {
      id: existing.id,
      name: existing.name,
      slug: existing.slug,
      description: existing.description,
      fileCount,
      createdAt: existing.createdAt.toISOString(),
      updatedAt: existing.updatedAt.toISOString(),
      version: existing.version,
    };
  }

  return createProject({ name: name || slug, slug }, userId);
}
