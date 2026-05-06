import { ulid } from 'ulid';
import { eq, desc, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projects } from '../db/schema.js';
import { getConfig } from '../config.js';
import { NotFoundError, AppError, ConflictError } from '../types/index.js';
import {
  isStorageAvailable,
  uploadObject,
  deleteObject,
  deleteObjects,
  getObject,
  listObjectKeys,
} from './storage.service.js';

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

// ── R2 key helpers ────────────────────────────────────────────────────────────

function projectFileKey(slug: string, fileName: string): string {
  return `projects/${slug}/${fileName}`;
}

function projectPrefix(slug: string): string {
  return `projects/${slug}/`;
}

function validateFileName(fileName: string): void {
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new AppError('INVALID_PATH', 'Path traversal detected', undefined, 400);
  }
}

// ── Local filesystem helpers (used only when R2 is not available) ────────────

async function localFs() {
  return (await import('node:fs')).promises;
}

async function localPath() {
  return (await import('node:path')).default;
}

function localProjectsDir(): string {
  return `${getConfig().dataDir}/projects`;
}

function localSafeJoin(base: string, ...parts: string[]): string {
  // Simple path join without requiring node:path at module level
  const joined = [base, ...parts].join('/').replace(/\/+/g, '/');
  if (!joined.startsWith(base.replace(/\/+$/, ''))) {
    throw new AppError('INVALID_PATH', 'Path traversal detected', undefined, 400);
  }
  return joined;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function getFileCount(slug: string): Promise<number> {
  if (isStorageAvailable()) {
    const keys = await listObjectKeys(projectPrefix(slug));
    return keys.filter((k) => k.endsWith('.md')).length;
  }
  const fs = await localFs();
  const path = await localPath();
  const dir = path.join(localProjectsDir(), slug);
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

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

  // Create directory on local filesystem when R2 is not available
  if (!isStorageAvailable()) {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(), slug);
    await fs.mkdir(dir, { recursive: true });
  }

  const id = ulid();
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

  // Local filesystem fallback — not available in Workers (no persistent FS)
  if (isStorageAvailable()) {
    throw new NotFoundError('Project');
  }

  const fs = await localFs();
  const path = await localPath();
  const dir = path.join(localProjectsDir(), slug);
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

export async function listProjects(userId?: string): Promise<ProjectMeta[]> {
  const db = getDb();

  const dbProjects = await db
    .select()
    .from(projects)
    .where(userId ? eq(projects.userId, userId) : undefined)
    .orderBy(desc(projects.updatedAt));

  const result: ProjectMeta[] = [];

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

  // Discover filesystem-only projects only when local storage is in use
  if (!isStorageAvailable()) {
    const fs = await localFs();
    const path = await localPath();
    const dir = localProjectsDir();
    const dbSlugs = new Set(dbProjects.map((p) => p.slug));
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

  if (isStorageAvailable()) {
    const keys = await listObjectKeys(projectPrefix(project.slug));
    await deleteObjects(keys);
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(), project.slug);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
  }

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

  if (isStorageAvailable()) {
    const keys = await listObjectKeys(projectPrefix(slug));
    return keys
      .filter((k) => k.endsWith('.md'))
      .map((k) => ({
        fileName: k.replace(projectPrefix(slug), ''),
        size: 0,
        updatedAt: new Date().toISOString(),
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  const fs = await localFs();
  const path = await localPath();
  const dir = path.join(localProjectsDir(), slug);
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
  validateFileName(fileName);
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }

  if (isStorageAvailable()) {
    const buf = await getObject(projectFileKey(slug, fileName));
    if (!buf) throw new NotFoundError('Project file');
    return buf.toString('utf-8');
  }

  const fs = await localFs();
  const path = await localPath();
  const filePath = localSafeJoin(localProjectsDir(), slug, fileName);
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
  validateFileName(fileName);
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }

  if (isStorageAvailable()) {
    // Verify project exists (check for any file, or skip — file creation is idempotent)
    await uploadObject(projectFileKey(slug, fileName), content, 'text/markdown');
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(), slug);
    try {
      await fs.access(dir);
    } catch {
      throw new NotFoundError('Project');
    }
    const filePath = localSafeJoin(dir, fileName);
    await fs.writeFile(filePath, content, 'utf-8');
  }

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
  validateFileName(fileName);
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }

  if (isStorageAvailable()) {
    // Check existence via head
    const keys = await listObjectKeys(projectFileKey(slug, fileName));
    if (keys.length > 0) throw new ConflictError('File already exists');
    await uploadObject(projectFileKey(slug, fileName), content, 'text/markdown');
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(), slug);
    try {
      await fs.access(dir);
    } catch {
      throw new NotFoundError('Project');
    }
    const filePath = localSafeJoin(dir, fileName);
    try {
      await fs.access(filePath);
      throw new ConflictError('File already exists');
    } catch (err) {
      if (err instanceof ConflictError) throw err;
    }
    await fs.writeFile(filePath, content, 'utf-8');
  }

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
  validateFileName(fileName);
  if (userId) {
    const db = getDb();
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
      .limit(1);
    if (!project) throw new NotFoundError('Project');
  }

  if (isStorageAvailable()) {
    await deleteObject(projectFileKey(slug, fileName));
  } else {
    const fs = await localFs();
    const path = await localPath();
    const filePath = localSafeJoin(localProjectsDir(), slug, fileName);
    try {
      await fs.unlink(filePath);
    } catch {
      throw new NotFoundError('Project file');
    }
  }

  const db = getDb();
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.slug, slug));
}

export async function generateProjectIndex(
  userId?: string
): Promise<{ path: string; projectCount: number }> {
  const allProjects = await listProjects(userId);

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

  const indexContent = lines.join('\n');

  if (isStorageAvailable()) {
    await uploadObject('projects/index.md', indexContent, 'text/markdown');
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = localProjectsDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.md'), indexContent, 'utf-8');
  }

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
