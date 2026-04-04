import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectStore } from './projectStore.js';

const KNOWN_TECH_TERMS = new Set([
  'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'PHP', 'C#', 'C++',
  'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'Remix',
  'Node.js', 'Deno', 'Bun', 'Express', 'Fastify', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Rails',
  'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'DynamoDB', 'Cassandra', 'Elasticsearch',
  'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Helm',
  'AWS', 'GCP', 'Azure', 'Vercel', 'Netlify', 'Heroku',
  'GraphQL', 'REST', 'gRPC', 'WebSocket', 'OAuth', 'JWT', 'SAML',
  'CI/CD', 'GitHub', 'GitLab', 'Jenkins', 'CircleCI', 'GitHub Actions',
  'Webpack', 'Vite', 'Rollup', 'esbuild',
  'Jest', 'Vitest', 'Playwright', 'Cypress', 'Mocha', 'Chai',
  'Linux', 'Unix', 'Bash', 'Shell',
  'Microservices', 'Serverless', 'Lambda', 'S3', 'RDS',
  'Redux', 'Zustand', 'MobX', 'Recoil',
  'Tailwind', 'Bootstrap', 'Material UI', 'Chakra UI',
  'Git', 'Agile', 'Scrum', 'Kanban',
]);

function extractKeywords(content: string): string[] {
  const found = new Set<string>();
  for (const term of KNOWN_TECH_TERMS) {
    if (content.includes(term)) {
      found.add(term);
    }
  }
  // Also extract capitalized tokens (2+ chars) not already found
  const capPattern = /\b[A-Z][a-zA-Z0-9.+#-]{1,}\b/g;
  const matches = content.matchAll(capPattern);
  for (const m of matches) {
    const token = m[0];
    if (!['The', 'This', 'That', 'With', 'And', 'For', 'But', 'Not', 'From', 'Into', 'Over', 'Used', 'Built', 'Each'].includes(token)) {
      found.add(token);
    }
  }
  return [...found].sort();
}

function slugToName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export class IndexStore {
  private readonly indexPath: string;

  constructor(private readonly storageDir: string) {
    this.indexPath = join(storageDir, 'index.md');
  }

  getIndex(): string {
    if (!existsSync(this.indexPath)) return '';
    return readFileSync(this.indexPath, 'utf8');
  }

  regenerateIndex(projectStore: ProjectStore): void {
    const projects = projectStore.listProjects();
    const sections: string[] = ['# Project Index\n'];

    for (const project of projects) {
      const content = projectStore.getProject(project.slug);
      const keywords = extractKeywords(content);
      const techTerms = keywords.filter(k => KNOWN_TECH_TERMS.has(k));
      const otherKeywords = keywords.filter(k => !KNOWN_TECH_TERMS.has(k));
      const name = slugToName(project.slug);

      let section = `## ${name}\n`;
      section += `- **File:** ${project.slug}.md\n`;
      if (techTerms.length > 0) {
        section += `- **Tech:** ${techTerms.join(', ')}\n`;
      }
      if (otherKeywords.length > 0) {
        section += `- **Keywords:** ${otherKeywords.join(', ')}\n`;
      }
      sections.push(section);
    }

    writeFileSync(this.indexPath, sections.join('\n'), 'utf8');
  }
}
