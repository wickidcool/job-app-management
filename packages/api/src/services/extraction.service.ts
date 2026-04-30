import { ulid } from 'ulid';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  resumes,
  applications,
  jobFitTags,
  techStackTags,
  quantifiedBullets,
  recurringThemes,
  companyCatalog,
  catalogDiffs,
  catalogChangeLog,
} from '../db/schema.js';
import type { DiffChange, ReviewItem } from '../db/schema.js';
import type { ChangeEvent } from './change-queue.service.js';
import { getConfig } from '../config.js';
import { parseResumeText, extractExperienceEntries } from './resume.service.js';
import { validateTechStackCategory, validateJobFitCategory } from '../types/index.js';

async function applyChangeToDb(tx: any, change: DiffChange, diffId: string, triggerSource: string, triggerId: string): Promise<void> {
  const data = change.data as Record<string, any>;
  const now = new Date();

  switch (change.entity) {
    case 'company_catalog': {
      if (change.action === 'create') {
        await tx.insert(companyCatalog).values({
          id: data.id,
          name: data.name,
          normalizedName: data.normalizedName,
          firstSeenAt: new Date(data.firstSeenAt),
          applicationCount: data.applicationCount ?? 1,
          latestStatus: data.latestStatus ?? null,
          latestAppId: data.latestAppId ?? null,
        }).onConflictDoNothing();
      } else if (change.action === 'update') {
        await tx
          .update(companyCatalog)
          .set({
            applicationCount: sql`application_count + 1`,
            latestStatus: data.latestStatus ?? null,
            latestAppId: data.latestAppId ?? null,
            updatedAt: now,
            version: sql`version + 1`,
          })
          .where(eq(companyCatalog.normalizedName, data.normalizedName));
      }
      break;
    }
    case 'tech_stack_tags': {
      if (change.action === 'create') {
        await tx.insert(techStackTags).values({
          id: data.id,
          tagSlug: data.tagSlug,
          displayName: data.displayName,
          category: validateTechStackCategory(data.category),
          sourceIds: data.sourceIds ?? [],
          mentionCount: data.mentionCount ?? 1,
          isLegacy: data.isLegacy ?? false,
        }).onConflictDoNothing();
      } else if (change.action === 'update') {
        await tx
          .update(techStackTags)
          .set({
            mentionCount: sql`mention_count + 1`,
            sourceIds: sql`(SELECT jsonb_agg(DISTINCT elem) FROM jsonb_array_elements_text(source_ids || ${JSON.stringify([data.sourceId])}::jsonb) AS elem)`,
            updatedAt: now,
            version: sql`version + 1`,
          })
          .where(eq(techStackTags.tagSlug, data.tagSlug));
      }
      break;
    }
    case 'job_fit_tags': {
      if (change.action === 'create') {
        await tx.insert(jobFitTags).values({
          id: data.id,
          tagSlug: data.tagSlug,
          displayName: data.displayName,
          category: validateJobFitCategory(data.category),
          sourceIds: data.sourceIds ?? [],
          mentionCount: data.mentionCount ?? 1,
        }).onConflictDoNothing();
      } else if (change.action === 'update') {
        await tx
          .update(jobFitTags)
          .set({
            mentionCount: sql`mention_count + 1`,
            sourceIds: sql`(SELECT jsonb_agg(DISTINCT elem) FROM jsonb_array_elements_text(source_ids || ${JSON.stringify([data.sourceId])}::jsonb) AS elem)`,
            updatedAt: now,
            version: sql`version + 1`,
          })
          .where(eq(jobFitTags.tagSlug, data.tagSlug));
      }
      break;
    }
    case 'quantified_bullets': {
      if (change.action === 'create') {
        await tx.insert(quantifiedBullets).values({
          id: data.id,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          rawText: data.rawText,
          actionVerb: data.actionVerb ?? null,
          metricType: data.metricType,
          metricValue: String(data.metricValue),
          metricRange: data.metricRange ?? null,
          isApproximate: data.isApproximate ?? false,
          secondaryMetricType: data.secondaryMetricType ?? null,
          secondaryMetricValue: data.secondaryMetricValue != null ? String(data.secondaryMetricValue) : null,
          impactCategory: data.impactCategory ?? 'other',
        });
      }
      break;
    }
    case 'recurring_themes': {
      if (change.action === 'create') {
        await tx.insert(recurringThemes).values({
          id: data.id,
          themeSlug: data.themeSlug,
          displayName: data.displayName,
          occurrenceCount: data.occurrenceCount ?? 1,
          sourceIds: data.sourceIds ?? [],
          exampleExcerpts: data.exampleExcerpts ?? [],
        }).onConflictDoNothing();
      } else if (change.action === 'update') {
        await tx
          .update(recurringThemes)
          .set({
            occurrenceCount: sql`occurrence_count + 1`,
            sourceIds: sql`(SELECT jsonb_agg(DISTINCT elem) FROM jsonb_array_elements_text(source_ids || ${JSON.stringify([data.sourceId])}::jsonb) AS elem)`,
            isCoreStrength: sql`occurrence_count + 1 >= 3`,
            lastSeenAt: now,
            updatedAt: now,
            version: sql`version + 1`,
          })
          .where(eq(recurringThemes.themeSlug, data.themeSlug));
      }
      break;
    }
  }

  await tx.insert(catalogChangeLog).values({
    id: ulid(),
    entityType: change.entity,
    entityId: String(data.id ?? data.tagSlug ?? data.themeSlug),
    action: change.action as any,
    beforeState: change.before ?? null,
    afterState: change.after ?? change.data,
    triggerSource,
    triggerId,
    diffId,
    committed: true,
    committedAt: now,
  });
}

// ── Tech stack taxonomy ──────────────────────────────────────────────────────

const TECH_STACK_TAXONOMY: Record<
  string,
  {
    displayName: string;
    category:
      | 'language'
      | 'frontend'
      | 'backend'
      | 'database'
      | 'cloud'
      | 'devops'
      | 'ai_ml'
      | 'uncategorized';
    legacy?: boolean;
  }
> = {
  typescript: { displayName: 'TypeScript', category: 'language' },
  javascript: { displayName: 'JavaScript', category: 'language' },
  python: { displayName: 'Python', category: 'language' },
  go: { displayName: 'Go', category: 'language' },
  rust: { displayName: 'Rust', category: 'language' },
  java: { displayName: 'Java', category: 'language' },
  'c#': { displayName: 'C#', category: 'language' },
  ruby: { displayName: 'Ruby', category: 'language' },
  swift: { displayName: 'Swift', category: 'language' },
  kotlin: { displayName: 'Kotlin', category: 'language' },
  react: { displayName: 'React', category: 'frontend' },
  vue: { displayName: 'Vue', category: 'frontend' },
  angular: { displayName: 'Angular', category: 'frontend' },
  svelte: { displayName: 'Svelte', category: 'frontend' },
  nextjs: { displayName: 'Next.js', category: 'frontend' },
  tailwind: { displayName: 'Tailwind CSS', category: 'frontend' },
  nodejs: { displayName: 'Node.js', category: 'backend' },
  express: { displayName: 'Express', category: 'backend' },
  fastify: { displayName: 'Fastify', category: 'backend' },
  django: { displayName: 'Django', category: 'backend' },
  fastapi: { displayName: 'FastAPI', category: 'backend' },
  flask: { displayName: 'Flask', category: 'backend' },
  postgresql: { displayName: 'PostgreSQL', category: 'database' },
  mysql: { displayName: 'MySQL', category: 'database' },
  mongodb: { displayName: 'MongoDB', category: 'database' },
  redis: { displayName: 'Redis', category: 'database' },
  dynamodb: { displayName: 'DynamoDB', category: 'database' },
  sqlite: { displayName: 'SQLite', category: 'database' },
  aws: { displayName: 'AWS', category: 'cloud' },
  gcp: { displayName: 'GCP', category: 'cloud' },
  azure: { displayName: 'Azure', category: 'cloud' },
  docker: { displayName: 'Docker', category: 'devops' },
  kubernetes: { displayName: 'Kubernetes', category: 'devops' },
  terraform: { displayName: 'Terraform', category: 'devops' },
  graphql: { displayName: 'GraphQL', category: 'backend' },
  tensorflow: { displayName: 'TensorFlow', category: 'ai_ml' },
  pytorch: { displayName: 'PyTorch', category: 'ai_ml' },
  langchain: { displayName: 'LangChain', category: 'ai_ml' },
  jquery: { displayName: 'jQuery', category: 'frontend', legacy: true },
  coffeescript: { displayName: 'CoffeeScript', category: 'language', legacy: true },
};

// Aliases that normalize to canonical slugs
const TECH_ALIASES: Record<string, string> = {
  'node.js': 'nodejs',
  node: 'nodejs',
  'next.js': 'nextjs',
  'react.js': 'react',
  reactjs: 'react',
  postgres: 'postgresql',
  pg: 'postgresql',
  'google cloud': 'gcp',
  'amazon web services': 'aws',
  k8s: 'kubernetes',
  ts: 'typescript',
  js: 'javascript',
};

// ── Job fit taxonomy ─────────────────────────────────────────────────────────

const JOB_FIT_PATTERNS: Array<{
  pattern: RegExp;
  slug: string;
  displayName: string;
  category: 'role' | 'industry' | 'seniority' | 'work_style' | 'uncategorized';
}> = [
  {
    pattern: /product\s+manag/i,
    slug: 'product-management',
    displayName: 'Product Management',
    category: 'role',
  },
  {
    pattern: /software\s+engineer/i,
    slug: 'software-engineering',
    displayName: 'Software Engineering',
    category: 'role',
  },
  { pattern: /data\s+scien/i, slug: 'data-science', displayName: 'Data Science', category: 'role' },
  {
    pattern: /machine\s+learn/i,
    slug: 'machine-learning',
    displayName: 'Machine Learning',
    category: 'role',
  },
  { pattern: /design(?:er)?/i, slug: 'design', displayName: 'Design', category: 'role' },
  {
    pattern: /devops|site\s+reliability|sre/i,
    slug: 'devops',
    displayName: 'DevOps / SRE',
    category: 'role',
  },
  {
    pattern: /fintech|financial\s+tech/i,
    slug: 'fintech',
    displayName: 'FinTech',
    category: 'industry',
  },
  {
    pattern: /healthcare|health\s+tech/i,
    slug: 'healthcare',
    displayName: 'Healthcare',
    category: 'industry',
  },
  {
    pattern: /e[\-\s]?commerce/i,
    slug: 'e-commerce',
    displayName: 'E-Commerce',
    category: 'industry',
  },
  { pattern: /remote/i, slug: 'remote', displayName: 'Remote', category: 'work_style' },
  { pattern: /hybrid/i, slug: 'hybrid', displayName: 'Hybrid', category: 'work_style' },
  { pattern: /on[\-\s]?site/i, slug: 'on-site', displayName: 'On-Site', category: 'work_style' },
  { pattern: /senior|sr\./i, slug: 'senior', displayName: 'Senior', category: 'seniority' },
  { pattern: /staff\s+engineer/i, slug: 'staff', displayName: 'Staff', category: 'seniority' },
  { pattern: /principal/i, slug: 'principal', displayName: 'Principal', category: 'seniority' },
];

// ── Theme patterns ────────────────────────────────────────────────────────────

const THEME_PATTERNS: Array<{ pattern: RegExp; slug: string; displayName: string }> = [
  {
    pattern: /cross[\-\s]?functional/i,
    slug: 'cross-functional-collaboration',
    displayName: 'Cross-Functional Collaboration',
  },
  {
    pattern: /team\s+lead|led\s+(a\s+)?team/i,
    slug: 'team-leadership',
    displayName: 'Team Leadership',
  },
  { pattern: /problem[\-\s]?solv/i, slug: 'problem-solving', displayName: 'Problem Solving' },
  { pattern: /innovat/i, slug: 'innovation', displayName: 'Innovation' },
  { pattern: /startup/i, slug: 'startup-experience', displayName: 'Startup Experience' },
  { pattern: /enterprise/i, slug: 'enterprise-experience', displayName: 'Enterprise Experience' },
  { pattern: /agile|scrum/i, slug: 'agile-scrum', displayName: 'Agile / Scrum' },
  { pattern: /mentor/i, slug: 'mentorship', displayName: 'Mentorship' },
  {
    pattern: /data[\-\s]?driven/i,
    slug: 'data-driven',
    displayName: 'Data-Driven Decision Making',
  },
];

// ── Quantified bullet patterns ────────────────────────────────────────────────

const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/;
const CURRENCY_RE = /\$\s*(\d+(?:[.,]\d+)?)\s*(k|m|b|million|billion|thousand)?/i;
const COUNT_RE = /\b(?:team\s+of|managed|led|supervised)\s+(\d+)/i;
const TIME_RE =
  /\b(?:reduced|saved|improved)\s+(?:by\s+)?(?:\d+\s+(?:hours?|days?|weeks?|months?))/i;
const MULTIPLIER_RE = /(\d+(?:\.\d+)?)\s*[xX]\s*(?:faster|improvement|increase|growth)/i;
const ACTION_VERB_RE =
  /^(increased|decreased|reduced|improved|led|managed|built|created|launched|delivered|grew|achieved|saved|generated|designed|implemented|developed|established|optimized|automated|scaled|drove|spearheaded|streamlined)\b/i;

function parseCurrencyValue(value: string, multiplier?: string): number {
  const num = parseFloat(value.replace(/,/g, ''));
  switch (multiplier?.toLowerCase()) {
    case 'k':
    case 'thousand':
      return num * 1000;
    case 'm':
    case 'million':
      return num * 1000000;
    case 'b':
    case 'billion':
      return num * 1000000000;
    default:
      return num;
  }
}

function extractQuantifiedBullets(text: string, sourceType: string, sourceId: string) {
  const lines = text
    .split(/\n|•|·/)
    .map((l) => l.trim())
    .filter((l) => l.length > 20);
  const bullets: Array<{
    sourceType: string;
    sourceId: string;
    rawText: string;
    actionVerb?: string;
    metricType: string;
    metricValue: number;
    metricRange?: [number, number];
    isApproximate: boolean;
    secondaryMetricType?: string;
    secondaryMetricValue?: number;
    impactCategory: string;
  }> = [];

  for (const line of lines) {
    const percentMatch = PERCENT_RE.exec(line);
    const currencyMatch = CURRENCY_RE.exec(line);
    const countMatch = COUNT_RE.exec(line);
    const multiplierMatch = MULTIPLIER_RE.exec(line);

    if (!percentMatch && !currencyMatch && !countMatch && !multiplierMatch && !TIME_RE.test(line)) {
      continue;
    }

    const actionVerbMatch = ACTION_VERB_RE.exec(line);
    const isApproximate = /~|approximately|roughly|about/i.test(line);

    let metricType: string | undefined;
    let metricValue: number | undefined;
    let secondaryMetricType: string | undefined;
    let secondaryMetricValue: number | undefined;
    let impactCategory = 'other';

    if (percentMatch) {
      metricType = 'percentage';
      metricValue = parseFloat(percentMatch[1]);
      if (/revenue|sales|conversion|growth/i.test(line)) impactCategory = 'revenue';
      else if (/cost|saving|spend/i.test(line)) impactCategory = 'cost_savings';
      else if (/user|customer|retention/i.test(line)) impactCategory = 'user_growth';
      else if (/performance|speed|latency/i.test(line)) impactCategory = 'performance';
      else if (/efficien|productiv/i.test(line)) impactCategory = 'efficiency';
    } else if (countMatch) {
      metricType = 'count';
      metricValue = parseInt(countMatch[1], 10);
      impactCategory = 'team_leadership';
    } else if (multiplierMatch) {
      metricType = 'multiplier';
      metricValue = parseFloat(multiplierMatch[1]);
      impactCategory = 'performance';
    } else if (TIME_RE.test(line)) {
      metricType = 'time';
      metricValue = 0;
      impactCategory = 'efficiency';
    }

    if (currencyMatch && metricType !== undefined && metricType !== 'currency') {
      secondaryMetricType = 'currency';
      secondaryMetricValue = parseCurrencyValue(currencyMatch[1], currencyMatch[2]);
      impactCategory = 'revenue';
    } else if (currencyMatch && metricType === undefined) {
      metricType = 'currency';
      metricValue = parseCurrencyValue(currencyMatch[1], currencyMatch[2]);
      impactCategory = 'revenue';
    }

    if (metricType === undefined || metricValue === undefined) continue;

    bullets.push({
      sourceType,
      sourceId,
      rawText: line,
      actionVerb: actionVerbMatch?.[1] ?? undefined,
      metricType,
      metricValue,
      isApproximate,
      secondaryMetricType,
      secondaryMetricValue,
      impactCategory,
    });
  }

  return bullets;
}

function normalizeTechSlug(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return TECH_ALIASES[lower] ?? lower.replace(/[.\s-]+/g, '').replace(/\s+/g, '-');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      intersectionSize++;
    }
  }
  return (2 * intersectionSize) / (a.length + b.length - 2);
}

async function getTextContent(
  sourceType: 'resume' | 'application',
  sourceId: string
): Promise<string> {
  const db = getDb();
  if (sourceType === 'resume') {
    const [resume] = await db.select().from(resumes).where(eq(resumes.id, sourceId));
    if (!resume) return '';
    const { promises: fs } = await import('node:fs');
    try {
      const content = await fs.readFile(resume.filePath);
      const { extractText } = await import('./resume.service.js');
      return await extractText(content, resume.mimeType);
    } catch {
      return '';
    }
  } else {
    const [app] = await db.select().from(applications).where(eq(applications.id, sourceId));
    if (!app) return '';
    return `${app.jobTitle} ${app.company} ${app.location ?? ''}`;
  }
}

export async function processCatalogChange(event: ChangeEvent): Promise<void> {
  const text = await getTextContent(event.sourceType, event.sourceId);
  if (!text) return;

  const changes: DiffChange[] = [];
  const pendingReview: ReviewItem[] = [];
  const db = getDb();

  // ── Company catalog ──────────────────────────────────────────────────────
  if (event.sourceType === 'application') {
    const [app] = await db.select().from(applications).where(eq(applications.id, event.sourceId));
    if (app?.company) {
      const normalized = slugify(app.company) || 'unspecified';
      const displayName = app.company || '[Unspecified]';
      const [existing] = await db
        .select()
        .from(companyCatalog)
        .where(eq(companyCatalog.normalizedName, normalized));
      if (!existing) {
        changes.push({
          entity: 'company_catalog',
          action: 'create',
          data: {
            id: ulid(),
            name: displayName,
            normalizedName: normalized,
            firstSeenAt: new Date().toISOString(),
            applicationCount: 1,
            latestStatus: app.status,
            latestAppId: app.id,
          },
        });
      } else {
        changes.push({
          entity: 'company_catalog',
          action: 'update',
          data: {
            id: existing.id,
            normalizedName: normalized,
            latestStatus: app.status,
            latestAppId: app.id,
          },
          before: {
            applicationCount: existing.applicationCount,
            latestStatus: existing.latestStatus,
          },
          after: { applicationCount: existing.applicationCount + 1, latestStatus: app.status },
        });
      }
    }
  } else if (event.sourceType === 'resume') {
    const parsed = parseResumeText(text);
    const entries = extractExperienceEntries(parsed);
    for (const entry of entries) {
      if (!entry.company) continue;
      const normalized = slugify(entry.company) || 'unspecified';
      const displayName = entry.company || '[Unspecified]';
      const [existing] = await db.select().from(companyCatalog).where(eq(companyCatalog.normalizedName, normalized));
      if (!existing) {
        changes.push({
          entity: 'company_catalog',
          action: 'create',
          data: {
            id: ulid(),
            name: displayName,
            normalizedName: normalized,
            firstSeenAt: new Date().toISOString(),
            applicationCount: 0,
            latestStatus: null,
            latestAppId: null,
          },
        });
      }
    }
  }

  // ── Tech stack tags ───────────────────────────────────────────────────────
  const existingTechSlugs = new Set(
    (await db.select({ tagSlug: techStackTags.tagSlug }).from(techStackTags)).map((r) => r.tagSlug)
  );

  for (const [canonicalSlug, meta] of Object.entries(TECH_STACK_TAXONOMY)) {
    const pattern = new RegExp(
      `\\b${meta.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i'
    );
    if (!pattern.test(text)) continue;

    const sourceIds = existingTechSlugs.has(canonicalSlug) ? undefined : [event.sourceId];

    if (!existingTechSlugs.has(canonicalSlug)) {
      changes.push({
        entity: 'tech_stack_tags',
        action: 'create',
        data: {
          id: ulid(),
          tagSlug: canonicalSlug,
          displayName: meta.displayName,
          category: meta.category,
          sourceIds: sourceIds ?? [event.sourceId],
          mentionCount: 1,
          isLegacy: meta.legacy ?? false,
        },
      });
    } else {
      changes.push({
        entity: 'tech_stack_tags',
        action: 'update',
        data: { tagSlug: canonicalSlug, sourceId: event.sourceId },
        before: {},
        after: { mentionCount: 'incremented', sourceIds: 'appended' },
      });
    }
  }

  // Check for "PM" ambiguity
  if (/\bPM\b/.test(text)) {
    pendingReview.push({
      type: 'ambiguous_tag',
      value: 'PM',
      options: ['Product Manager', 'Project Manager'],
    });
  }

  // ── Job fit tags ──────────────────────────────────────────────────────────
  const existingJobFitSlugs = new Set(
    (await db.select({ tagSlug: jobFitTags.tagSlug }).from(jobFitTags)).map((r) => r.tagSlug)
  );

  for (const { pattern, slug, displayName, category } of JOB_FIT_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (!existingJobFitSlugs.has(slug)) {
      changes.push({
        entity: 'job_fit_tags',
        action: 'create',
        data: {
          id: ulid(),
          tagSlug: slug,
          displayName,
          category,
          sourceIds: [event.sourceId],
          mentionCount: 1,
        },
      });
    } else {
      changes.push({
        entity: 'job_fit_tags',
        action: 'update',
        data: { tagSlug: slug, sourceId: event.sourceId },
        before: {},
        after: { mentionCount: 'incremented', sourceIds: 'appended' },
      });
    }
  }

  // ── Quantified bullets ────────────────────────────────────────────────────
  if (event.sourceType === 'resume') {
    const existingBulletTexts = new Set(
      (await db.select({ rawText: quantifiedBullets.rawText }).from(quantifiedBullets).where(eq(quantifiedBullets.sourceId, event.sourceId))).map(r => r.rawText),
    );
    const bullets = extractQuantifiedBullets(text, event.sourceType, event.sourceId);
    for (const bullet of bullets) {
      if (existingBulletTexts.has(bullet.rawText)) continue;
      existingBulletTexts.add(bullet.rawText);
      changes.push({
        entity: 'quantified_bullets',
        action: 'create',
        data: { id: ulid(), ...bullet },
      });
    }
  }

  // ── Recurring themes ──────────────────────────────────────────────────────
  const existingThemeSlugs = new Set(
    (await db.select({ themeSlug: recurringThemes.themeSlug }).from(recurringThemes)).map(
      (r) => r.themeSlug
    )
  );

  for (const { pattern, slug, displayName } of THEME_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (!existingThemeSlugs.has(slug)) {
      changes.push({
        entity: 'recurring_themes',
        action: 'create',
        data: {
          id: ulid(),
          themeSlug: slug,
          displayName,
          occurrenceCount: 1,
          sourceIds: [event.sourceId],
          exampleExcerpts: [],
        },
      });
    } else {
      changes.push({
        entity: 'recurring_themes',
        action: 'update',
        data: { themeSlug: slug, sourceId: event.sourceId },
        before: {},
        after: { occurrenceCount: 'incremented', sourceIds: 'appended' },
      });
    }
  }

  // ── Wikilink resolution ───────────────────────────────────────────────────
  const wikilinkMatches = [...text.matchAll(/\[\[([^\]]+)\]\]/g)];
  for (const match of wikilinkMatches) {
    const linkText = match[1];
    const normalized = slugify(linkText);
    pendingReview.push({
      type: 'unresolved_wikilink',
      value: linkText,
    });
  }

  if (changes.length === 0 && pendingReview.length === 0) return;

  const changeCount = changes.filter(c => c.action === 'create').length;
  const updateCount = changes.filter(c => c.action === 'update').length;
  const hasNewCompany = changes.some(c => c.entity === 'company_catalog' && c.action === 'create');
  const shouldAutoApply = pendingReview.length === 0 && changes.length > 0 && !hasNewCompany;
  const summary =
    changes.length === 0
      ? 'No changes detected'
      : [
          changeCount > 0 ? `${changeCount} new entries` : '',
          updateCount > 0 ? `${updateCount} updates` : '',
          pendingReview.length > 0 ? `${pendingReview.length} items need review` : '',
          shouldAutoApply ? '(auto-applied)' : '',
        ]
          .filter(Boolean)
          .join(', ');

  const diffId = ulid();
  const triggerSource = event.sourceType === 'resume' ? 'resume_upload' : 'app_change';
  const now = new Date();

  if (shouldAutoApply) {
    await db.transaction(async (tx) => {
      for (const change of changes) {
        await applyChangeToDb(tx, change, diffId, triggerSource, event.sourceId);
      }
    });
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await db.insert(catalogDiffs).values({
    id: diffId,
    triggerSource,
    triggerId: event.sourceId,
    summary,
    changes,
    pendingReview,
    status: shouldAutoApply ? 'approved' : 'pending',
    expiresAt: shouldAutoApply ? null : expiresAt,
    resolvedAt: shouldAutoApply ? now : null,
  });
}
