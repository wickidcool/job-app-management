import { eq, and, ilike, asc, desc, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import {
  companyCatalog,
  jobFitTags,
  techStackTags,
  quantifiedBullets,
  recurringThemes,
  catalogDiffs,
  catalogChangeLog,
  wikilinkRegistry,
} from '../db/schema.js';
import type { DiffChange, ReviewItem } from '../db/schema.js';
import {
  NotFoundError,
  AppError,
  VALID_JOB_FIT_CATEGORIES,
  VALID_TECH_STACK_CATEGORIES,
  validateTechStackCategory,
  validateJobFitCategory,
  type JobFitCategory,
  type TechStackCategory,
} from '../types/index.js';
import { processCatalogChange } from './extraction.service.js';

// ── Company catalog ──────────────────────────────────────────────────────────

export interface ListCompaniesOptions {
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string;
}

export async function listCompanies(opts: ListCompaniesOptions = {}) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = opts.cursor ? parseInt(Buffer.from(opts.cursor, 'base64url').toString(), 10) : 0;

  const conditions = [];
  if (!opts.includeDeleted) conditions.push(eq(companyCatalog.isDeleted, false));
  if (opts.search) conditions.push(ilike(companyCatalog.name, `%${opts.search}%`));

  const rows = await db
    .select()
    .from(companyCatalog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(companyCatalog.applicationCount))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? Buffer.from(String(offset + limit)).toString('base64url')
    : undefined;

  return { companies: items.map(toCompanyDTO), nextCursor };
}

function toCompanyDTO(row: typeof companyCatalog.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    aliases: row.aliases,
    firstSeen: row.firstSeenAt.toISOString(),
    applicationCount: row.applicationCount,
    latestStatus: row.latestStatus,
    isDeleted: row.isDeleted,
    version: row.version,
  };
}

export async function mergeCompanies(sourceIds: string[], targetId: string) {
  const db = getDb();
  const [target] = await db.select().from(companyCatalog).where(eq(companyCatalog.id, targetId));
  if (!target) throw new NotFoundError('Company');

  const sources = await db
    .select()
    .from(companyCatalog)
    .where(
      sql`${companyCatalog.id} = ANY(${sourceIds})`,
    );

  const totalCount = sources.reduce((s, c) => s + c.applicationCount, target.applicationCount);
  const allAliases = [...new Set([...target.aliases, ...sources.map(s => s.name)])];

  await db.transaction(async (tx) => {
    await tx
      .update(companyCatalog)
      .set({ applicationCount: totalCount, aliases: allAliases, updatedAt: new Date(), version: target.version + 1 })
      .where(eq(companyCatalog.id, targetId));
    await tx
      .update(companyCatalog)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(sql`${companyCatalog.id} = ANY(${sourceIds})`);
  });

  const [updated] = await db.select().from(companyCatalog).where(eq(companyCatalog.id, targetId));
  return { mergedCompany: toCompanyDTO(updated!), mergedCount: sources.length };
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export interface ListTagsOptions {
  category?: string;
  needsReview?: boolean;
  search?: string;
  limit?: number;
  cursor?: string;
}

export async function listJobFitTags(opts: ListTagsOptions = {}) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = opts.cursor ? parseInt(Buffer.from(opts.cursor, 'base64url').toString(), 10) : 0;

  const conditions = [];
  if (opts.category && VALID_JOB_FIT_CATEGORIES.includes(opts.category as JobFitCategory)) {
    conditions.push(eq(jobFitTags.category, opts.category as JobFitCategory));
  }
  if (opts.needsReview) conditions.push(eq(jobFitTags.needsReview, true));
  if (opts.search) conditions.push(ilike(jobFitTags.displayName, `%${opts.search}%`));

  const rows = await db
    .select()
    .from(jobFitTags)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(jobFitTags.mentionCount))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : undefined;

  return { tags: items.map(toJobFitTagDTO), nextCursor };
}

function toJobFitTagDTO(row: typeof jobFitTags.$inferSelect) {
  return {
    id: row.id,
    tagSlug: row.tagSlug,
    displayName: row.displayName,
    category: row.category,
    mentionCount: row.mentionCount,
    sourceIds: row.sourceIds ?? [],
    needsReview: row.needsReview,
    reviewOptions: row.reviewOptions,
    version: row.version,
  };
}

export async function updateJobFitTag(
  id: string,
  patch: { displayName?: string; category?: string; needsReview?: boolean; version: number },
) {
  const db = getDb();
  const [existing] = await db.select().from(jobFitTags).where(eq(jobFitTags.id, id));
  if (!existing) throw new NotFoundError('JobFitTag');

  if (patch.category !== undefined && !VALID_JOB_FIT_CATEGORIES.includes(patch.category as JobFitCategory)) {
    throw new AppError('INVALID_CATEGORY', `Invalid job fit category: ${patch.category}. Valid values: ${VALID_JOB_FIT_CATEGORIES.join(', ')}`, {}, 400);
  }

  const [updated] = await db
    .update(jobFitTags)
    .set({
      ...(patch.displayName !== undefined && { displayName: patch.displayName }),
      ...(patch.category !== undefined && { category: patch.category as JobFitCategory }),
      ...(patch.needsReview !== undefined && { needsReview: patch.needsReview }),
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(and(eq(jobFitTags.id, id), eq(jobFitTags.version, patch.version)))
    .returning();

  if (!updated) throw new NotFoundError('JobFitTag (version conflict)');
  return toJobFitTagDTO(updated);
}

export async function mergeJobFitTags(sourceIds: string[], targetId: string) {
  const db = getDb();
  const [target] = await db.select().from(jobFitTags).where(eq(jobFitTags.id, targetId));
  if (!target) throw new NotFoundError('JobFitTag');

  const sources = await db
    .select()
    .from(jobFitTags)
    .where(sql`${jobFitTags.id} = ANY(${sourceIds})`);

  const totalMentions = sources.reduce((s, t) => s + t.mentionCount, target.mentionCount);
  const allSourceIds = [...new Set([...target.sourceIds, ...sources.flatMap(s => s.sourceIds)])];
  const allAliases = [...new Set([...target.aliases, ...sources.map(s => s.tagSlug)])];

  await db.transaction(async (tx) => {
    await tx
      .update(jobFitTags)
      .set({ mentionCount: totalMentions, sourceIds: allSourceIds, aliases: allAliases, updatedAt: new Date(), version: target.version + 1 })
      .where(eq(jobFitTags.id, targetId));
    for (const id of sourceIds) {
      await tx.delete(jobFitTags).where(eq(jobFitTags.id, id));
    }
  });

  const [updated] = await db.select().from(jobFitTags).where(eq(jobFitTags.id, targetId));
  return { mergedTag: toJobFitTagDTO(updated!), mergedCount: sources.length };
}

export async function listTechStackTags(opts: ListTagsOptions = {}) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = opts.cursor ? parseInt(Buffer.from(opts.cursor, 'base64url').toString(), 10) : 0;

  const conditions = [];
  if (opts.category && VALID_TECH_STACK_CATEGORIES.includes(opts.category as TechStackCategory)) {
    conditions.push(eq(techStackTags.category, opts.category as TechStackCategory));
  }
  if (opts.needsReview) conditions.push(eq(techStackTags.needsReview, true));
  if (opts.search) conditions.push(ilike(techStackTags.displayName, `%${opts.search}%`));

  const rows = await db
    .select()
    .from(techStackTags)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(techStackTags.mentionCount))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : undefined;

  return { tags: items.map(toTechStackTagDTO), nextCursor };
}

function toTechStackTagDTO(row: typeof techStackTags.$inferSelect) {
  return {
    id: row.id,
    tagSlug: row.tagSlug,
    displayName: row.displayName,
    category: row.category,
    mentionCount: row.mentionCount,
    sourceIds: row.sourceIds ?? [],
    versionMentioned: row.versionMentioned,
    isLegacy: row.isLegacy,
    needsReview: row.needsReview,
    version: row.version,
  };
}

export async function updateTechStackTag(
  id: string,
  patch: { displayName?: string; category?: string; needsReview?: boolean; version: number },
) {
  const db = getDb();
  const [existing] = await db.select().from(techStackTags).where(eq(techStackTags.id, id));
  if (!existing) throw new NotFoundError('TechStackTag');

  if (patch.category !== undefined && !VALID_TECH_STACK_CATEGORIES.includes(patch.category as TechStackCategory)) {
    throw new AppError('INVALID_CATEGORY', `Invalid tech stack category: ${patch.category}. Valid values: ${VALID_TECH_STACK_CATEGORIES.join(', ')}`, {}, 400);
  }

  const [updated] = await db
    .update(techStackTags)
    .set({
      ...(patch.displayName !== undefined && { displayName: patch.displayName }),
      ...(patch.category !== undefined && { category: patch.category as TechStackCategory }),
      ...(patch.needsReview !== undefined && { needsReview: patch.needsReview }),
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(and(eq(techStackTags.id, id), eq(techStackTags.version, patch.version)))
    .returning();

  if (!updated) throw new NotFoundError('TechStackTag (version conflict)');
  return toTechStackTagDTO(updated);
}

export async function mergeTechStackTags(sourceIds: string[], targetId: string) {
  const db = getDb();
  const [target] = await db.select().from(techStackTags).where(eq(techStackTags.id, targetId));
  if (!target) throw new NotFoundError('TechStackTag');

  const sources = await db
    .select()
    .from(techStackTags)
    .where(sql`${techStackTags.id} = ANY(${sourceIds})`);

  const totalMentions = sources.reduce((s, t) => s + t.mentionCount, target.mentionCount);
  const allSourceIds = [...new Set([...target.sourceIds, ...sources.flatMap(s => s.sourceIds)])];
  const allAliases = [...new Set([...target.aliases, ...sources.map(s => s.tagSlug)])];

  await db.transaction(async (tx) => {
    await tx
      .update(techStackTags)
      .set({ mentionCount: totalMentions, sourceIds: allSourceIds, aliases: allAliases, updatedAt: new Date(), version: target.version + 1 })
      .where(eq(techStackTags.id, targetId));
    for (const id of sourceIds) {
      await tx.delete(techStackTags).where(eq(techStackTags.id, id));
    }
  });

  const [updated] = await db.select().from(techStackTags).where(eq(techStackTags.id, targetId));
  return { mergedTag: toTechStackTagDTO(updated!), mergedCount: sources.length };
}

// ── Quantified bullets ────────────────────────────────────────────────────────

export interface ListBulletsOptions {
  impactCategory?: string;
  sourceId?: string;
  limit?: number;
  cursor?: string;
}

export async function listBullets(opts: ListBulletsOptions = {}) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = opts.cursor ? parseInt(Buffer.from(opts.cursor, 'base64url').toString(), 10) : 0;

  const conditions = [];
  if (opts.impactCategory) conditions.push(eq(quantifiedBullets.impactCategory, opts.impactCategory as any));
  if (opts.sourceId) conditions.push(eq(quantifiedBullets.sourceId, opts.sourceId));

  const rows = await db
    .select()
    .from(quantifiedBullets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(quantifiedBullets.extractedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : undefined;

  return {
    bullets: items.map(r => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      rawText: r.rawText,
      actionVerb: r.actionVerb,
      metricType: r.metricType,
      metricValue: r.metricValue,
      isApproximate: r.isApproximate,
      secondaryMetricType: r.secondaryMetricType,
      secondaryMetricValue: r.secondaryMetricValue,
      impactCategory: r.impactCategory,
      sourceName: r.sourceType === 'resume' ? 'Resume' : 'Application',
      extractedAt: r.extractedAt.toISOString(),
    })),
    nextCursor,
  };
}

// ── Recurring themes ──────────────────────────────────────────────────────────

export interface ListThemesOptions {
  coreOnly?: boolean;
  includeHistorical?: boolean;
  limit?: number;
  cursor?: string;
}

export async function listThemes(opts: ListThemesOptions = {}) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = opts.cursor ? parseInt(Buffer.from(opts.cursor, 'base64url').toString(), 10) : 0;

  const conditions = [];
  if (opts.coreOnly) conditions.push(eq(recurringThemes.isCoreStrength, true));
  if (!opts.includeHistorical) conditions.push(eq(recurringThemes.isHistorical, false));

  const rows = await db
    .select()
    .from(recurringThemes)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(recurringThemes.occurrenceCount))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : undefined;

  return {
    themes: items.map(r => ({
      id: r.id,
      themeSlug: r.themeSlug,
      displayName: r.displayName,
      occurrenceCount: r.occurrenceCount,
      sourceIds: r.sourceIds,
      exampleExcerpts: r.exampleExcerpts,
      isCoreStrength: r.isCoreStrength,
      isHistorical: r.isHistorical,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    })),
    nextCursor,
  };
}

// ── Diffs ─────────────────────────────────────────────────────────────────────

export interface ListDiffsOptions {
  status?: string;
  limit?: number;
  cursor?: string;
}

export async function listDiffs(opts: ListDiffsOptions = {}) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.cursor ? parseInt(Buffer.from(opts.cursor, 'base64url').toString(), 10) : 0;

  const conditions = [];
  if (opts.status) {
    conditions.push(eq(catalogDiffs.status, opts.status as any));
  } else {
    conditions.push(eq(catalogDiffs.status, 'pending'));
  }

  const rows = await db
    .select()
    .from(catalogDiffs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(catalogDiffs.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : undefined;

  return {
    diffs: items.map(r => ({
      id: r.id,
      triggerSource: r.triggerSource,
      triggerId: r.triggerId,
      summary: r.summary,
      changeCount: (r.changes as DiffChange[]).length,
      pendingReviewCount: (r.pendingReview as ReviewItem[]).length,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
    })),
    nextCursor,
  };
}

export async function getDiff(id: string) {
  const db = getDb();
  const [diff] = await db.select().from(catalogDiffs).where(eq(catalogDiffs.id, id));
  if (!diff) throw new NotFoundError('CatalogDiff');

  return {
    id: diff.id,
    triggerSource: diff.triggerSource,
    triggerId: diff.triggerId,
    summary: diff.summary,
    changeCount: (diff.changes as DiffChange[]).length,
    pendingReviewCount: (diff.pendingReview as ReviewItem[]).length,
    status: diff.status,
    createdAt: diff.createdAt.toISOString(),
    expiresAt: diff.expiresAt?.toISOString() ?? null,
    changes: diff.changes as DiffChange[],
    pendingReview: diff.pendingReview as ReviewItem[],
  };
}

export interface ApplyDiffInput {
  action: 'approve_all' | 'reject_all' | 'partial';
  decisions?: Array<{ changeIndex: number; approved: boolean }>;
  reviewDecisions?: Array<{
    reviewIndex: number;
    selectedOption?: string;
    action: 'resolve' | 'skip' | 'create_new';
  }>;
}

export async function applyDiff(id: string, input: ApplyDiffInput) {
  const db = getDb();
  const [diff] = await db.select().from(catalogDiffs).where(eq(catalogDiffs.id, id));
  if (!diff) throw new NotFoundError('CatalogDiff');

  if (diff.status !== 'pending') {
    throw new Error(`Diff is already ${diff.status}`);
  }

  const changes = diff.changes as DiffChange[];
  const now = new Date();

  let appliedCount = 0;
  let rejectedCount = 0;

  if (input.action === 'reject_all') {
    await db
      .update(catalogDiffs)
      .set({ status: 'rejected', resolvedAt: now, userDecisions: input })
      .where(eq(catalogDiffs.id, id));
    return { applied: 0, rejected: changes.length, pendingReview: 0, status: 'rejected' };
  }

  const approvedIndices = new Set(
    input.action === 'approve_all'
      ? changes.map((_, i) => i)
      : (input.decisions ?? []).filter(d => d.approved).map(d => d.changeIndex),
  );

  await db.transaction(async (tx) => {
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!approvedIndices.has(i)) {
        rejectedCount++;
        continue;
      }

      try {
        await applyChange(tx, change);
        await tx.insert(catalogChangeLog).values({
          id: ulid(),
          entityType: change.entity,
          entityId: String((change.data as any).id ?? (change.data as any).tagSlug ?? i),
          action: change.action as any,
          beforeState: change.before ?? null,
          afterState: change.after ?? change.data,
          triggerSource: diff.triggerSource,
          triggerId: diff.triggerId,
          diffId: id,
          committed: true,
          committedAt: now,
        });
        appliedCount++;
      } catch (err) {
        console.error('[catalog] Failed to apply change', i, err);
        rejectedCount++;
      }
    }

    const finalStatus: 'approved' | 'partial' | 'rejected' =
      appliedCount === 0 ? 'rejected' : rejectedCount === 0 ? 'approved' : 'partial';

    await tx
      .update(catalogDiffs)
      .set({ status: finalStatus, resolvedAt: now, userDecisions: input })
      .where(eq(catalogDiffs.id, id));
  });

  const pendingReviewCount = (diff.pendingReview as ReviewItem[]).length;
  const finalStatus = appliedCount === 0 ? 'rejected' : rejectedCount === 0 ? 'approved' : 'partial';
  return { applied: appliedCount, rejected: rejectedCount, pendingReview: pendingReviewCount, status: finalStatus };
}

async function applyChange(tx: any, change: DiffChange): Promise<void> {
  const data = change.data as Record<string, any>;

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
            updatedAt: new Date(),
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
            updatedAt: new Date(),
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
            updatedAt: new Date(),
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
            lastSeenAt: new Date(),
            updatedAt: new Date(),
            version: sql`version + 1`,
          })
          .where(eq(recurringThemes.themeSlug, data.themeSlug));
      }
      break;
    }
  }
}

export async function generateDiff(
  sourceType: 'resume' | 'application',
  sourceId: string,
) {
  const db = getDb();
  await processCatalogChange({
    id: ulid(),
    sourceType,
    sourceId,
    changeType: 'created',
    timestamp: new Date().toISOString(),
  });
  const [diff] = await db
    .select()
    .from(catalogDiffs)
    .where(and(eq(catalogDiffs.triggerSource, sourceType === 'resume' ? 'resume_upload' : 'app_change'), eq(catalogDiffs.triggerId, sourceId)))
    .orderBy(desc(catalogDiffs.createdAt))
    .limit(1);
  if (!diff) throw new NotFoundError('CatalogDiff');
  return {
    id: diff.id,
    triggerSource: diff.triggerSource,
    triggerId: diff.triggerId,
    summary: diff.summary,
    changeCount: (diff.changes as DiffChange[]).length,
    pendingReviewCount: (diff.pendingReview as ReviewItem[]).length,
    status: diff.status,
    createdAt: diff.createdAt.toISOString(),
    expiresAt: diff.expiresAt?.toISOString() ?? null,
    changes: diff.changes as DiffChange[],
    pendingReview: diff.pendingReview as ReviewItem[],
  };
}

export async function discardDiff(id: string): Promise<void> {
  const db = getDb();
  const [diff] = await db.select().from(catalogDiffs).where(eq(catalogDiffs.id, id));
  if (!diff) throw new NotFoundError('CatalogDiff');
  await db.delete(catalogDiffs).where(eq(catalogDiffs.id, id));
}

export async function resolveDiffItem(
  id: string,
  input: {
    itemType: 'change' | 'review';
    itemIndex: number;
    decision: 'approve' | 'reject';
    selectedOption?: string;
  },
) {
  const db = getDb();
  const [diff] = await db.select().from(catalogDiffs).where(eq(catalogDiffs.id, id));
  if (!diff) throw new NotFoundError('CatalogDiff');

  const existing = (diff.userDecisions as any) ?? {};
  const changeDecisions: Record<number, { decision: string; selectedOption?: string }> = existing.changeDecisions ?? {};
  const reviewDecisions: Record<number, { decision: string; selectedOption?: string }> = existing.reviewDecisions ?? {};
  if (input.itemType === 'change') {
    changeDecisions[input.itemIndex] = { decision: input.decision, selectedOption: input.selectedOption };
  } else {
    reviewDecisions[input.itemIndex] = { decision: input.decision, selectedOption: input.selectedOption };
  }
  const decisions = { changeDecisions, reviewDecisions };

  await db
    .update(catalogDiffs)
    .set({ userDecisions: decisions })
    .where(eq(catalogDiffs.id, id));

  return { id, updated: true };
}
