import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import slugify from 'slugify';

export class NotFoundError extends Error {
  constructor(slug: string) {
    super(`Project not found: ${slug}`);
    this.name = 'NotFoundError';
  }
}

export interface ProjectMeta {
  slug: string;
  name: string;
  size: number;
  mtime: Date;
}

export function getProjectsDir(storageDir: string): string {
  return join(storageDir, 'projects');
}

export class ProjectStore {
  private readonly projectsDir: string;

  constructor(private readonly storageDir: string) {
    this.projectsDir = getProjectsDir(storageDir);
    mkdirSync(this.projectsDir, { recursive: true });
  }

  createProject(name: string, content: string): string {
    const baseSlug = slugify(name, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 2;
    while (existsSync(join(this.projectsDir, `${slug}.md`))) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    writeFileSync(join(this.projectsDir, `${slug}.md`), content, 'utf8');
    return slug;
  }

  getProject(slug: string): string {
    const filePath = join(this.projectsDir, `${slug}.md`);
    if (!existsSync(filePath)) throw new NotFoundError(slug);
    return readFileSync(filePath, 'utf8');
  }

  updateProject(slug: string, content: string): void {
    const filePath = join(this.projectsDir, `${slug}.md`);
    if (!existsSync(filePath)) throw new NotFoundError(slug);
    writeFileSync(filePath, content, 'utf8');
  }

  deleteProject(slug: string): void {
    const filePath = join(this.projectsDir, `${slug}.md`);
    if (!existsSync(filePath)) throw new NotFoundError(slug);
    unlinkSync(filePath);
  }

  listProjects(): ProjectMeta[] {
    return readdirSync(this.projectsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const slug = f.replace(/\.md$/, '');
        const stat = statSync(join(this.projectsDir, f));
        return { slug, name: slug, size: stat.size, mtime: stat.mtime };
      });
  }
}
