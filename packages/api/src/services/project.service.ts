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
//
// WIC-1433 — project artefacts are namespaced by owner, exactly like resume
// storage (`storage.service.buildObjectKey`). **A slug does not identify a
// project.** Migration 0017 dropped the global unique on `projects.slug` and
// replaced it with the per-user composite `idx_projects_user_slug`, so two users
// may legitimately both own `acme-corp`. While these keys were slug-only the DB
// ownership guards all passed — each one asks "does *this* user own a project
// called `acme-corp`?", and for the second user the answer is legitimately yes —
// and then the filesystem call underneath resolved to the *first* user's
// directory. The check and the object key have to agree on what identifies a
// project, so the owner is now part of the key.

/**
 * Owner segment of a storage key. Mirrors `buildObjectKey`'s `userId ?? 'anon'`
 * so resume and project artefacts share one namespacing convention: in
 * production the JWT always supplies a `userId`, and `anon` is only reached in
 * the local auth-bypass dev mode where there is a single implicit user.
 *
 * The parity is on that fallback only — **the traversal guard below is
 * deliberately not in `buildObjectKey`** (WIC-1469). `storage.service` never
 * touches the filesystem, so its keys are only ever R2/S3 object keys, where
 * `..` is an ordinary key character. This owner segment is also joined into a
 * real path by `localProjectsDir` on the local-filesystem backend, which is
 * what makes the guard load-bearing here and inert there.
 */
function storageOwner(userId?: string): string {
  const owner = userId ?? 'anon';
  // The owner segment becomes a path component on the local-filesystem backend,
  // so it gets the same traversal guard as a file name. `userId` arrives from a
  // JWT `sub` claim, which is not ours to trust blindly.
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || owner.includes('..')) {
    throw new AppError('INVALID_PATH', 'Invalid storage owner', undefined, 400);
  }
  return owner;
}

export function projectFileKey(userId: string | undefined, slug: string, fileName: string): string {
  return `${projectPrefix(userId, slug)}${fileName}`;
}

function projectPrefix(userId: string | undefined, slug: string): string {
  return `${ownerProjectsPrefix(userId)}${slug}/`;
}

function ownerProjectsPrefix(userId?: string): string {
  return `projects/${storageOwner(userId)}/`;
}

function validateFileName(fileName: string): void {
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new AppError('INVALID_PATH', 'Path traversal detected', undefined, 400);
  }
}

/**
 * WIC-1554 — the owner is **required** for every `projects` row access.
 *
 * The decision, written down because the recurrence this closes is that each
 * previous fix scoped itself to one function and left the shared fallback
 * intact: *there is no owner-less caller this module serves.* Both halves hold.
 *
 * 1. No owner-less row can exist. `createProject` is the only `insert(projects)`
 *    in `src/` and it rejects a missing `userId`; `projects.user_id` is
 *    `NOT NULL` (schema, and migration `0017_enforce_userid_not_null.sql:29`).
 *    So an owner-less predicate cannot match "the anonymous user's project" —
 *    it can only match *somebody else's*. There is no correct outcome to
 *    preserve, which is what makes "require it" a total fix rather than a trade.
 * 2. No owner-less caller should reach here. `middleware/auth.ts` now rejects a
 *    token that verifies but carries no `sub`, so `userId: null` no longer
 *    survives into a request in any configuration that has auth switched on.
 *
 * The cost is deliberate and stated: in the local auth-bypass dev mode
 * (`SUPABASE_URL` *and* `SUPABASE_JWT_SECRET` both absent — ADR-003) every
 * project route now answers 400 rather than operating on an implicit shared
 * user. That mode already could not *create* a project since WIC-1434, so this
 * makes an existing dead end honest instead of letting reads and deletes wander
 * into a real user's rows.
 *
 * `action` is not decoration: several of these guards answer the same
 * `BAD_REQUEST`/400, so without a distinct message a test cannot tell which one
 * fired and grades the wrong function (the AC-R1/AC-R8 lesson from WIC-1434).
 */
function requireOwner(userId: string | undefined, action: string): string {
  if (!userId) {
    throw new AppError('BAD_REQUEST', `userId is required to ${action}`, undefined, 400);
  }
  return userId;
}

/**
 * The `where` every slug-keyed project lookup and write must carry.
 * Slug alone matches one row per user, so an unscoped predicate reaches (and,
 * for an UPDATE with no `LIMIT`, rewrites) every tenant holding that slug.
 * The owner is required rather than optional — see `requireOwner`.
 */
function projectScope(slug: string, userId: string | undefined, action: string) {
  const owner = requireOwner(userId, action);
  return and(eq(projects.slug, slug), eq(projects.userId, owner));
}

/**
 * The same, keyed on the primary key. An id is not a capability: `projects.id`
 * is a ULID belonging to exactly one user, so an id-only predicate is a
 * cross-tenant reach the moment the id is guessed, logged or leaked.
 */
function projectIdScope(projectId: string, userId: string | undefined, action: string) {
  const owner = requireOwner(userId, action);
  return and(eq(projects.id, projectId), eq(projects.userId, owner));
}

/**
 * Throw `NotFoundError` unless `userId` owns a project with this slug.
 *
 * Until WIC-1554 this returned early when `userId` was absent, so it backstopped
 * nothing for exactly the caller that needed backstopping. It now requires the
 * owner like every other access here. This only establishes *whether the caller
 * has a project by this name*; it is the owner-namespaced storage key, not this
 * check, that decides which files the call then touches.
 */
async function assertProjectOwned(slug: string, userId?: string): Promise<void> {
  const where = projectScope(slug, userId, 'access a project');
  const db = getDb();
  const [project] = await db.select({ id: projects.id }).from(projects).where(where).limit(1);
  if (!project) throw new NotFoundError('Project');
}

/**
 * Re-stamp `updated_at` after a file mutation. Scoped: an UPDATE keyed on slug
 * alone carries no `LIMIT`, so before WIC-1433 one user saving a file re-stamped
 * *every* user's row holding that slug and reshuffled their `listProjects`
 * ordering (which sorts on `updatedAt DESC`). WIC-1433 routed it through
 * `projectScope`, which still degraded to that same slug-only UPDATE whenever
 * the caller had no identity; WIC-1554 removed the degradation.
 */
async function touchProject(slug: string, userId?: string): Promise<void> {
  const where = projectScope(slug, userId, 'update a project');
  const db = getDb();
  await db.update(projects).set({ updatedAt: new Date() }).where(where);
}

// ── Local filesystem helpers (used only when R2 is not available) ────────────

async function localFs() {
  return (await import('node:fs')).promises;
}

async function localPath() {
  return (await import('node:path')).default;
}

/** Root of one owner's project tree: `{dataDir}/projects/{userId}`. */
export function localProjectsDir(userId?: string): string {
  return `${getConfig().dataDir}/projects/${storageOwner(userId)}`;
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

async function getFileCount(userId: string | undefined, slug: string): Promise<number> {
  if (isStorageAvailable()) {
    const keys = await listObjectKeys(projectPrefix(userId, slug));
    return keys.filter((k) => k.endsWith('.md')).length;
  }
  const fs = await localFs();
  const path = await localPath();
  const dir = path.join(localProjectsDir(userId), slug);
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

  // WIC-1434 — the owner check runs *before* the existence check. Reversed, an
  // owner-less create reached `projectScope(slug, undefined)`, which degrades to
  // a slug-only match, and answered 409 "already exists" — disclosing that some
  // other user holds this slug, to a caller who was going to be rejected anyway.
  // The 400 is both the honest answer and the one that leaks nothing.
  if (!userId) {
    throw new AppError('BAD_REQUEST', 'userId is required to create a project', undefined, 400);
  }

  const existing = await db
    .select()
    .from(projects)
    .where(projectScope(slug, userId, 'create a project'))
    .limit(1);
  if (existing.length > 0) {
    throw new ConflictError('Project with this slug already exists');
  }

  // Create directory on local filesystem when R2 is not available
  if (!isStorageAvailable()) {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(userId), slug);
    await fs.mkdir(dir, { recursive: true });
  }

  const id = ulid();
  const [project] = await db
    .insert(projects)
    .values({
      id,
      userId,
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

export async function getProject(projectId: string, userId?: string): Promise<ProjectMeta> {
  // Guard before `getDb()`: no query should be issued on behalf of a caller
  // with no identity, and an id-only predicate is a cross-tenant read.
  const whereClause = projectIdScope(projectId, userId, 'load a project');
  const db = getDb();
  const [project] = await db.select().from(projects).where(whereClause).limit(1);

  if (!project) {
    throw new NotFoundError('Project');
  }

  // Key off the row's own owner, never the caller's — they are the same after
  // the guard above, and the row is the authority on where its files live.
  const fileCount = await getFileCount(project.userId, project.slug);

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
  const where = projectScope(slug, userId, 'resolve a project by slug');
  const db = getDb();
  const [project] = await db.select().from(projects).where(where).limit(1);

  if (project) {
    const fileCount = await getFileCount(project.userId, project.slug);
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

  // Local filesystem fallback — not available in Workers (no persistent FS).
  // Scoped to the caller's own tree: before WIC-1433 this stat'd the shared
  // `data/projects/{slug}` and so answered "does *anyone* own this slug?",
  // an existence-and-metadata oracle for another user's projects.
  if (isStorageAvailable()) {
    throw new NotFoundError('Project');
  }

  const fs = await localFs();
  const path = await localPath();
  const dir = path.join(localProjectsDir(userId), slug);
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
  // The widest of the three degradations this file carried: a falsy `userId`
  // handed Drizzle `undefined`, which is not a permissive predicate so much as
  // *no* predicate — the SELECT returned every tenant's projects, not one
  // slug's worth. Same requirement as the rest, for the same reason.
  const owner = requireOwner(userId, 'list projects');
  const db = getDb();

  const dbProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, owner))
    .orderBy(desc(projects.updatedAt));

  const result: ProjectMeta[] = [];

  for (const project of dbProjects) {
    const fileCount = await getFileCount(project.userId, project.slug);
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
    const dir = localProjectsDir(userId);
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
  // The destructive site. `whereClause` is reused for the DELETE below, and the
  // storage prefix on line ~478 is built from `project.userId` — the *row's*
  // owner — so an id-only match here did not merely disclose another user's
  // project, it deleted their row and emptied their object-store namespace.
  const whereClause = projectIdScope(projectId, userId, 'delete a project');
  const db = getDb();
  const [project] = await db.select().from(projects).where(whereClause).limit(1);

  if (!project) {
    throw new NotFoundError('Project');
  }

  if (isStorageAvailable()) {
    const keys = await listObjectKeys(projectPrefix(project.userId, project.slug));
    await deleteObjects(keys);
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(project.userId), project.slug);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
  }

  await db.delete(projects).where(whereClause);
}

export async function listProjectFiles(slug: string, userId?: string): Promise<ProjectFileMeta[]> {
  await assertProjectOwned(slug, userId);

  if (isStorageAvailable()) {
    const prefix = projectPrefix(userId, slug);
    const keys = await listObjectKeys(prefix);
    return keys
      .filter((k) => k.endsWith('.md'))
      .map((k) => ({
        fileName: k.replace(prefix, ''),
        size: 0,
        updatedAt: new Date().toISOString(),
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  const fs = await localFs();
  const path = await localPath();
  const dir = path.join(localProjectsDir(userId), slug);
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
  await assertProjectOwned(slug, userId);

  if (isStorageAvailable()) {
    const buf = await getObject(projectFileKey(userId, slug, fileName));
    if (!buf) throw new NotFoundError('Project file');
    return buf.toString('utf-8');
  }

  const fs = await localFs();
  const path = await localPath();
  const filePath = localSafeJoin(localProjectsDir(userId), slug, fileName);
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
  await assertProjectOwned(slug, userId);

  if (isStorageAvailable()) {
    // Verify project exists (check for any file, or skip — file creation is idempotent)
    await uploadObject(projectFileKey(userId, slug, fileName), content, 'text/markdown');
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(userId), slug);
    try {
      await fs.access(dir);
    } catch {
      throw new NotFoundError('Project');
    }
    const filePath = localSafeJoin(dir, fileName);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  await touchProject(slug, userId);
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
  await assertProjectOwned(slug, userId);

  if (isStorageAvailable()) {
    // Check existence via head
    const keys = await listObjectKeys(projectFileKey(userId, slug, fileName));
    if (keys.length > 0) throw new ConflictError('File already exists');
    await uploadObject(projectFileKey(userId, slug, fileName), content, 'text/markdown');
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = path.join(localProjectsDir(userId), slug);
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

  await touchProject(slug, userId);
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
  await assertProjectOwned(slug, userId);

  if (isStorageAvailable()) {
    await deleteObject(projectFileKey(userId, slug, fileName));
  } else {
    const fs = await localFs();
    const path = await localPath();
    const filePath = localSafeJoin(localProjectsDir(userId), slug, fileName);
    try {
      await fs.unlink(filePath);
    } catch {
      throw new NotFoundError('Project file');
    }
  }

  await touchProject(slug, userId);
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
    // `userId` is required here. Omitting it skipped the ownership guard *and*
    // resolved the shared slug-only prefix, so the index enumerated other
    // users' file names.
    const files = await listProjectFiles(project.slug, userId).catch(() => [] as ProjectFileMeta[]);
    for (const file of files) {
      lines.push(`  - [${file.fileName}](${project.slug}/${file.fileName})`);
    }
    lines.push('');
  }

  const indexContent = lines.join('\n');
  // One index per owner. The single global `projects/index.md` meant each
  // user's index overwrote the previous user's.
  const indexKey = `${ownerProjectsPrefix(userId)}index.md`;

  if (isStorageAvailable()) {
    await uploadObject(indexKey, indexContent, 'text/markdown');
  } else {
    const fs = await localFs();
    const path = await localPath();
    const dir = localProjectsDir(userId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.md'), indexContent, 'utf-8');
  }

  return { path: indexKey, projectCount: allProjects.length };
}

/**
 * Resolve the caller's project with this slug, creating it if they have none.
 *
 * `userId` is **required**. It was the first function here to require it and
 * for a while the only one — WIC-1434 landed while the other lookups still fell
 * back to a slug-only predicate on an absent `userId`, described then as the
 * deliberate local auth-bypass dev mode. WIC-1554 measured that fallback and
 * removed it everywhere (`requireOwner`); the reasoning below generalised, so
 * this is no longer the exception it was written as.
 * The fallback is never correct here, and WIC-1434 is the proof:
 * `createProject` is the only `insert(projects)` in the codebase and it rejects
 * a missing `userId`, so every row in `projects` has a real owner. An
 * owner-less call therefore has exactly two possible outcomes — the reuse
 * branch hands back some authenticated user's row (their project id and file
 * count, to a caller who is not them, and their project is then treated as the
 * caller's for the rest of the request), or the create branch throws. Neither
 * is a behaviour worth preserving, so the parameter is required and the
 * predicate is spelled out rather than delegated to the conditional helper.
 */
export async function getOrCreateProjectBySlug(
  slug: string,
  name: string | undefined,
  userId: string
): Promise<ProjectMeta> {
  // Belt and braces with the required type: this is reachable from JS callers
  // and from a JWT whose `sub` claim is absent, where `userId` is `null` at
  // runtime however the signature reads.
  if (!userId) {
    throw new AppError(
      'BAD_REQUEST',
      'userId is required to resolve a project by slug',
      undefined,
      400
    );
  }

  const db = getDb();
  // Scoped, and deliberately not via `projectScope` — that helper degrades to a
  // slug-only match on a falsy `userId`, which is the defect this function had.
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)))
    .limit(1);

  if (existing) {
    const fileCount = await getFileCount(existing.userId, existing.slug);
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
