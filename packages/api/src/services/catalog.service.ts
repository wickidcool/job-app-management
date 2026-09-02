import { eq, and, ilike, asc, desc, inArray, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { encodeCursor, parseCursor } from '../lib/pagination.js';
import {
  companyCatalog,
  jobFitTags,
  techStackTags,
  quantifiedBullets,
  recurringThemes,
  catalogDiffs,
  catalogChangeLog,
  wikilinkRegistry,
  resumes,
  applications,
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

/**
 * Reject a source list a merge cannot safely act on, before it builds any
 * predicate or touches the database.
 *
 * Empty list: `inArray(col, [])` does not render `false` on the drizzle-orm
 * pinned here (0.30.10) — it throws `inArray requires at least one value` while
 * the query is being built, which would surface as an opaque 500. The routes
 * already enforce `.min(1)` on both merge bodies (`catalog.routes.ts:70,75`), so
 * that only guards a direct service call — but it makes that call fail with a
 * 400 like the route would, rather than a 500 from inside the query builder.
 *
 * Target listed as its own source: `sourcesWhere` is exactly the predicate the
 * merge soft-deletes by (companies) or hard-deletes by (tags), and it is built
 * from `sourceIds` alone — nothing excludes the target. So a target that also
 * appears in its own source list is destroyed by its own merge: companies come
 * back HTTP 200 with the survivor already `isDeleted`, and the tag paths delete
 * the row outright, after which the `updated!` re-read is undefined and the DTO
 * mapper throws an opaque 500. Both are unrecoverable for the tag case, so this
 * rejects the input rather than trying to repair it. See WIC-1395.
 */
function assertMergeSources(sourceIds: string[], targetId: string) {
  if (sourceIds.length === 0) {
    throw new AppError('BAD_REQUEST', 'A merge needs at least one source id', undefined, 400);
  }
  if (sourceIds.includes(targetId)) {
    throw new AppError('BAD_REQUEST', 'A merge target cannot also be a source', undefined, 400);
  }
}

// ── Company catalog ──────────────────────────────────────────────────────────

export interface ListCompaniesOptions {
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string;
}

export async function listCompanies(opts: ListCompaniesOptions = {}, userId?: string) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = parseCursor(opts.cursor);

  const conditions = [];
  if (userId) conditions.push(eq(companyCatalog.userId, userId));
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
  const nextCursor = hasMore ? encodeCursor(offset + limit) : undefined;

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

export async function mergeCompanies(sourceIds: string[], targetId: string, userId: string) {
  const db = getDb();
  assertMergeSources(sourceIds, targetId);
  // Every read AND every write is scoped to the caller, so a known id belonging
  // to another user can neither be folded into a target nor soft-deleted. The
  // owner is required rather than optional (ADR-010 D2): an absent owner used to
  // degrade this to a bare id match, which is the cross-tenant merge WIC-1365
  // closed. Local dev resolves a real owner at the route edge (ADR-010 D3), so
  // there is no owner-absent path left for this predicate to serve.
  const targetWhere = and(eq(companyCatalog.id, targetId), eq(companyCatalog.userId, userId));
  // The id term must be `inArray`, never a raw `= ANY(${sourceIds})`: Drizzle
  // interpolates a JS array into a `sql` template as a comma-separated
  // parameter list, so that renders `= ANY(($1, $2))` — a row constructor,
  // which Postgres rejects outright. See the WIC-1377 tests.
  const sourcesWhere = and(
    inArray(companyCatalog.id, sourceIds),
    eq(companyCatalog.userId, userId)
  );

  const [target] = await db.select().from(companyCatalog).where(targetWhere);
  if (!target) throw new NotFoundError('Company');

  const sources = await db.select().from(companyCatalog).where(sourcesWhere);

  const totalCount = sources.reduce((s, c) => s + c.applicationCount, target.applicationCount);
  const allAliases = [...new Set([...target.aliases, ...sources.map((s) => s.name)])];
  // The survivor inherits the earliest sighting across everything being folded
  // together, not just its own. Duplicates usually appear because a company was
  // re-entered under a new spelling, so the source is normally the *older* row;
  // keeping the target's date unconditionally would walk `firstSeen` forward in
  // time, and the source is soft-deleted, so nothing else can recover it.
  const earliestFirstSeen = sources.reduce(
    (earliest, s) => (s.firstSeenAt < earliest ? s.firstSeenAt : earliest),
    target.firstSeenAt
  );

  await db.transaction(async (tx) => {
    await tx
      .update(companyCatalog)
      .set({
        applicationCount: totalCount,
        aliases: allAliases,
        firstSeenAt: earliestFirstSeen,
        updatedAt: new Date(),
        version: target.version + 1,
      })
      .where(targetWhere);
    await tx
      .update(companyCatalog)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(sourcesWhere);
  });

  const [updated] = await db.select().from(companyCatalog).where(targetWhere);
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

export async function listJobFitTags(opts: ListTagsOptions = {}, userId?: string) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = parseCursor(opts.cursor);

  const conditions = [];
  if (userId) conditions.push(eq(jobFitTags.userId, userId));
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
  const nextCursor = hasMore ? encodeCursor(offset + limit) : undefined;

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
  userId: string
) {
  const db = getDb();
  // Scope the read so another user's tag reports NotFound rather than falling
  // through to the version check and reporting a misleading version conflict.
  const scoped = and(eq(jobFitTags.id, id), eq(jobFitTags.userId, userId));
  const [existing] = await db.select().from(jobFitTags).where(scoped);
  if (!existing) throw new NotFoundError('JobFitTag');

  if (
    patch.category !== undefined &&
    !VALID_JOB_FIT_CATEGORIES.includes(patch.category as JobFitCategory)
  ) {
    throw new AppError(
      'INVALID_CATEGORY',
      `Invalid job fit category: ${patch.category}. Valid values: ${VALID_JOB_FIT_CATEGORIES.join(', ')}`,
      {},
      400
    );
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
    // Re-assert the tenancy term on the write itself: the read above and this
    // update are separate statements, so an id-only predicate here is still
    // exploitable on its own.
    .where(and(scoped, eq(jobFitTags.version, patch.version)))
    .returning();

  if (!updated) throw new NotFoundError('JobFitTag (version conflict)');
  return toJobFitTagDTO(updated);
}

export async function mergeJobFitTags(sourceIds: string[], targetId: string, userId: string) {
  const db = getDb();
  assertMergeSources(sourceIds, targetId);
  // See mergeCompanies: the owner is required, so neither the target read nor
  // the source read can degrade to a bare id match (ADR-010 D2).
  const targetWhere = and(eq(jobFitTags.id, targetId), eq(jobFitTags.userId, userId));
  // See mergeCompanies: `inArray`, not a raw `= ANY(${sourceIds})` template.
  const sourcesWhere = and(inArray(jobFitTags.id, sourceIds), eq(jobFitTags.userId, userId));

  const [target] = await db.select().from(jobFitTags).where(targetWhere);
  if (!target) throw new NotFoundError('JobFitTag');

  const sources = await db.select().from(jobFitTags).where(sourcesWhere);

  const totalMentions = sources.reduce((s, t) => s + t.mentionCount, target.mentionCount);
  const allSourceIds = [...new Set([...target.sourceIds, ...sources.flatMap((s) => s.sourceIds)])];
  const allAliases = [...new Set([...target.aliases, ...sources.map((s) => s.tagSlug)])];

  await db.transaction(async (tx) => {
    await tx
      .update(jobFitTags)
      .set({
        mentionCount: totalMentions,
        sourceIds: allSourceIds,
        aliases: allAliases,
        updatedAt: new Date(),
        version: target.version + 1,
      })
      .where(targetWhere);
    // Delete is a hard delete, so it iterates the rows the *scoped* read
    // returned rather than the caller's raw sourceIds — an id the read
    // excluded must not still be deleted by an id-only predicate.
    for (const source of sources) {
      await tx
        .delete(jobFitTags)
        .where(and(eq(jobFitTags.id, source.id), eq(jobFitTags.userId, userId)));
    }
  });

  const [updated] = await db.select().from(jobFitTags).where(targetWhere);
  return { mergedTag: toJobFitTagDTO(updated!), mergedCount: sources.length };
}

export async function listTechStackTags(opts: ListTagsOptions = {}, userId?: string) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = parseCursor(opts.cursor);

  const conditions = [];
  if (userId) conditions.push(eq(techStackTags.userId, userId));
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
  const nextCursor = hasMore ? encodeCursor(offset + limit) : undefined;

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
  userId: string
) {
  const db = getDb();
  // See updateJobFitTag: scoped so another user's tag is NotFound, not a
  // misleading version conflict. Owner required per ADR-010 D2.
  const scoped = and(eq(techStackTags.id, id), eq(techStackTags.userId, userId));
  const [existing] = await db.select().from(techStackTags).where(scoped);
  if (!existing) throw new NotFoundError('TechStackTag');

  if (
    patch.category !== undefined &&
    !VALID_TECH_STACK_CATEGORIES.includes(patch.category as TechStackCategory)
  ) {
    throw new AppError(
      'INVALID_CATEGORY',
      `Invalid tech stack category: ${patch.category}. Valid values: ${VALID_TECH_STACK_CATEGORIES.join(', ')}`,
      {},
      400
    );
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
    .where(and(scoped, eq(techStackTags.version, patch.version)))
    .returning();

  if (!updated) throw new NotFoundError('TechStackTag (version conflict)');
  return toTechStackTagDTO(updated);
}

export async function mergeTechStackTags(sourceIds: string[], targetId: string, userId: string) {
  const db = getDb();
  assertMergeSources(sourceIds, targetId);
  // See mergeCompanies: the owner is required, so neither the target read nor
  // the source read can degrade to a bare id match (ADR-010 D2).
  const targetWhere = and(eq(techStackTags.id, targetId), eq(techStackTags.userId, userId));
  // See mergeCompanies: `inArray`, not a raw `= ANY(${sourceIds})` template.
  const sourcesWhere = and(inArray(techStackTags.id, sourceIds), eq(techStackTags.userId, userId));

  const [target] = await db.select().from(techStackTags).where(targetWhere);
  if (!target) throw new NotFoundError('TechStackTag');

  const sources = await db.select().from(techStackTags).where(sourcesWhere);

  const totalMentions = sources.reduce((s, t) => s + t.mentionCount, target.mentionCount);
  const allSourceIds = [...new Set([...target.sourceIds, ...sources.flatMap((s) => s.sourceIds)])];
  const allAliases = [...new Set([...target.aliases, ...sources.map((s) => s.tagSlug)])];

  await db.transaction(async (tx) => {
    await tx
      .update(techStackTags)
      .set({
        mentionCount: totalMentions,
        sourceIds: allSourceIds,
        aliases: allAliases,
        updatedAt: new Date(),
        version: target.version + 1,
      })
      .where(targetWhere);
    // See mergeJobFitTags: hard delete iterates the scoped read, not sourceIds.
    for (const source of sources) {
      await tx
        .delete(techStackTags)
        .where(and(eq(techStackTags.id, source.id), eq(techStackTags.userId, userId)));
    }
  });

  const [updated] = await db.select().from(techStackTags).where(targetWhere);
  return { mergedTag: toTechStackTagDTO(updated!), mergedCount: sources.length };
}

// ── Quantified bullets ────────────────────────────────────────────────────────

export interface ListBulletsOptions {
  impactCategory?: string;
  sourceId?: string;
  limit?: number;
  cursor?: string;
}

export async function listBullets(opts: ListBulletsOptions = {}, userId?: string) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = parseCursor(opts.cursor);

  const conditions = [];
  if (userId) conditions.push(eq(quantifiedBullets.userId, userId));
  if (opts.impactCategory)
    conditions.push(eq(quantifiedBullets.impactCategory, opts.impactCategory as any));
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
  const nextCursor = hasMore ? encodeCursor(offset + limit) : undefined;

  return {
    bullets: items.map((r) => ({
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

// ── STAR Catalog Entries ──────────────────────────────────────────────────────

export async function listStarEntries(userId?: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(quantifiedBullets)
    .where(userId ? eq(quantifiedBullets.userId, userId) : undefined)
    .orderBy(desc(quantifiedBullets.extractedAt));

  return rows.map((r) => ({
    id: r.id,
    title: r.rawText.slice(0, 100) + (r.rawText.length > 100 ? '...' : ''),
    situation: '',
    task: '',
    action: r.actionVerb || '',
    result: r.rawText,
    tags: [
      r.impactCategory,
      r.metricType,
      ...(r.secondaryMetricType ? [r.secondaryMetricType] : []),
    ].filter(Boolean),
    timeframe: undefined,
    relevanceScore: undefined,
    relevanceReasoning: undefined,
  }));
}

// ── Recurring themes ──────────────────────────────────────────────────────────

export interface ListThemesOptions {
  coreOnly?: boolean;
  includeHistorical?: boolean;
  limit?: number;
  cursor?: string;
}

export async function listThemes(opts: ListThemesOptions = {}, userId?: string) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 250);
  const offset = parseCursor(opts.cursor);

  const conditions = [];
  if (userId) conditions.push(eq(recurringThemes.userId, userId));
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
  const nextCursor = hasMore ? encodeCursor(offset + limit) : undefined;

  return {
    themes: items.map((r) => ({
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

export async function listDiffs(opts: ListDiffsOptions = {}, userId?: string) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = parseCursor(opts.cursor);

  const conditions = [];
  if (userId) conditions.push(eq(catalogDiffs.userId, userId));
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
  const nextCursor = hasMore ? encodeCursor(offset + limit) : undefined;

  return {
    diffs: items.map((r) => ({
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

export async function getDiff(id: string, userId?: string) {
  const db = getDb();
  const whereClause = userId
    ? and(eq(catalogDiffs.id, id), eq(catalogDiffs.userId, userId))
    : eq(catalogDiffs.id, id);
  const [diff] = await db.select().from(catalogDiffs).where(whereClause);
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

export async function applyDiff(id: string, input: ApplyDiffInput, userId?: string) {
  const db = getDb();
  const whereClause = userId
    ? and(eq(catalogDiffs.id, id), eq(catalogDiffs.userId, userId))
    : eq(catalogDiffs.id, id);
  const [diff] = await db.select().from(catalogDiffs).where(whereClause);
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
      : (input.decisions ?? []).filter((d) => d.approved).map((d) => d.changeIndex)
  );

  await db.transaction(async (tx) => {
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!approvedIndices.has(i)) {
        rejectedCount++;
        continue;
      }

      try {
        await applyChange(tx, change, userId);
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
  const finalStatus =
    appliedCount === 0 ? 'rejected' : rejectedCount === 0 ? 'approved' : 'partial';
  return {
    applied: appliedCount,
    rejected: rejectedCount,
    pendingReview: pendingReviewCount,
    status: finalStatus,
  };
}

async function applyChange(tx: any, change: DiffChange, userId?: string): Promise<void> {
  const data = change.data as Record<string, any>;

  switch (change.entity) {
    case 'company_catalog': {
      if (change.action === 'create') {
        await tx
          .insert(companyCatalog)
          .values({
            id: data.id,
            userId: userId!,
            name: data.name,
            normalizedName: data.normalizedName,
            firstSeenAt: new Date(data.firstSeenAt),
            applicationCount: data.applicationCount ?? 1,
            latestStatus: data.latestStatus ?? null,
            latestAppId: data.latestAppId ?? null,
          })
          .onConflictDoNothing();
      } else if (change.action === 'update') {
        const whereClause = userId
          ? and(
              eq(companyCatalog.normalizedName, data.normalizedName),
              eq(companyCatalog.userId, userId)
            )
          : eq(companyCatalog.normalizedName, data.normalizedName);
        await tx
          .update(companyCatalog)
          .set({
            applicationCount: sql`application_count + 1`,
            latestStatus: data.latestStatus ?? null,
            latestAppId: data.latestAppId ?? null,
            updatedAt: new Date(),
            version: sql`version + 1`,
          })
          .where(whereClause);
      }
      break;
    }
    case 'tech_stack_tags': {
      if (change.action === 'create') {
        await tx
          .insert(techStackTags)
          .values({
            id: data.id,
            userId: userId!,
            tagSlug: data.tagSlug,
            displayName: data.displayName,
            category: validateTechStackCategory(data.category),
            sourceIds: data.sourceIds ?? [],
            mentionCount: data.mentionCount ?? 1,
            isLegacy: data.isLegacy ?? false,
          })
          .onConflictDoNothing();
      } else if (change.action === 'update') {
        const whereClause = userId
          ? and(eq(techStackTags.tagSlug, data.tagSlug), eq(techStackTags.userId, userId))
          : eq(techStackTags.tagSlug, data.tagSlug);
        await tx
          .update(techStackTags)
          .set({
            mentionCount: sql`mention_count + 1`,
            sourceIds: sql`(SELECT jsonb_agg(DISTINCT elem) FROM jsonb_array_elements_text(source_ids || ${JSON.stringify([data.sourceId])}::jsonb) AS elem)`,
            updatedAt: new Date(),
            version: sql`version + 1`,
          })
          .where(whereClause);
      }
      break;
    }
    case 'job_fit_tags': {
      if (change.action === 'create') {
        await tx
          .insert(jobFitTags)
          .values({
            id: data.id,
            userId: userId!,
            tagSlug: data.tagSlug,
            displayName: data.displayName,
            category: validateJobFitCategory(data.category),
            sourceIds: data.sourceIds ?? [],
            mentionCount: data.mentionCount ?? 1,
          })
          .onConflictDoNothing();
      } else if (change.action === 'update') {
        const whereClause = userId
          ? and(eq(jobFitTags.tagSlug, data.tagSlug), eq(jobFitTags.userId, userId))
          : eq(jobFitTags.tagSlug, data.tagSlug);
        await tx
          .update(jobFitTags)
          .set({
            mentionCount: sql`mention_count + 1`,
            sourceIds: sql`(SELECT jsonb_agg(DISTINCT elem) FROM jsonb_array_elements_text(source_ids || ${JSON.stringify([data.sourceId])}::jsonb) AS elem)`,
            updatedAt: new Date(),
            version: sql`version + 1`,
          })
          .where(whereClause);
      }
      break;
    }
    case 'quantified_bullets': {
      if (change.action === 'create') {
        await tx.insert(quantifiedBullets).values({
          id: data.id,
          userId: userId ?? null,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          rawText: data.rawText,
          actionVerb: data.actionVerb ?? null,
          metricType: data.metricType,
          metricValue: String(data.metricValue),
          metricRange: data.metricRange ?? null,
          isApproximate: data.isApproximate ?? false,
          secondaryMetricType: data.secondaryMetricType ?? null,
          secondaryMetricValue:
            data.secondaryMetricValue != null ? String(data.secondaryMetricValue) : null,
          impactCategory: data.impactCategory ?? 'other',
        });
      }
      break;
    }
    case 'recurring_themes': {
      if (change.action === 'create') {
        await tx
          .insert(recurringThemes)
          .values({
            id: data.id,
            userId: userId!,
            themeSlug: data.themeSlug,
            displayName: data.displayName,
            occurrenceCount: data.occurrenceCount ?? 1,
            sourceIds: data.sourceIds ?? [],
            exampleExcerpts: data.exampleExcerpts ?? [],
          })
          .onConflictDoNothing();
      } else if (change.action === 'update') {
        const whereClause = userId
          ? and(eq(recurringThemes.themeSlug, data.themeSlug), eq(recurringThemes.userId, userId))
          : eq(recurringThemes.themeSlug, data.themeSlug);
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
          .where(whereClause);
      }
      break;
    }
  }
}

export async function generateDiff(
  sourceType: 'resume' | 'application',
  sourceId: string,
  userId: string
) {
  const db = getDb();
  // The route validates only the *shape* of sourceId, so an authenticated
  // caller may name any user's document ULID. Nothing downstream re-checks it
  // on the way in: getTextContent reads the source row by id alone, and the
  // extraction that follows auto-applies whatever it finds into the *caller's*
  // catalog before the scoped lookup below ever runs. Resolving ownership here
  // is what makes the 404 a decision this boundary takes, rather than a side
  // effect of a predicate two layers down — so it holds even if the reader
  // beneath is later widened.
  if (userId) {
    const [owned] =
      sourceType === 'resume'
        ? await db
            .select({ id: resumes.id })
            .from(resumes)
            .where(and(eq(resumes.id, sourceId), eq(resumes.userId, userId)))
        : await db
            .select({ id: applications.id })
            .from(applications)
            .where(and(eq(applications.id, sourceId), eq(applications.userId, userId)));
    // Same 404 the owner's own missing document yields — a foreign id and an
    // absent one must stay indistinguishable to the caller.
    if (!owned) throw new NotFoundError(sourceType === 'resume' ? 'Resume' : 'Application');
  }
  // processCatalogChange reads the owner off event.metadata.userId (the shape
  // resume.service.ts uses when it enqueues). Omitting it wrote the diff row —
  // and every catalog row auto-applied alongside it — with user_id null, which
  // no scoped reader (listDiffs / getDiff / applyDiff) can ever see again.
  //
  // It is also the tenancy check itself: `sourceId` comes straight from the
  // request body, so the caller's identity is the thing being tested and it has
  // to travel with the event. Without it `resolveOwnerUserId` falls back to the
  // source row's own `user_id`, the "owner" resolves to the victim, and the
  // scoped document read matches by construction. `?? null` rather than bare
  // `userId`: in local-dev auth bypass `userId` is undefined,
  // `typeof null === 'string'` is false, and the row fallback still applies, so
  // single-user local behaviour is unchanged.
  await processCatalogChange({
    id: ulid(),
    sourceType,
    sourceId,
    changeType: 'created',
    timestamp: new Date().toISOString(),
    metadata: { userId },
  });
  const conditions = [
    eq(catalogDiffs.triggerSource, sourceType === 'resume' ? 'resume_upload' : 'app_change'),
    eq(catalogDiffs.triggerId, sourceId),
  ];
  // Without this, a caller naming another user's resume/application id gets
  // back whichever diff is newest for that trigger. processCatalogChange bails
  // early when the source yields no text, so the row this call would otherwise
  // have inserted need not exist — the lookup then falls through to the owner's.
  // Unconditional: the owner is required, so this term is always present.
  conditions.push(eq(catalogDiffs.userId, userId));
  const [diff] = await db
    .select()
    .from(catalogDiffs)
    .where(and(...conditions))
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

export async function discardDiff(id: string, userId?: string): Promise<void> {
  const db = getDb();
  const whereClause = userId
    ? and(eq(catalogDiffs.id, id), eq(catalogDiffs.userId, userId))
    : eq(catalogDiffs.id, id);
  const [diff] = await db.select().from(catalogDiffs).where(whereClause);
  if (!diff) throw new NotFoundError('CatalogDiff');
  await db.delete(catalogDiffs).where(whereClause);
}

export async function resolveDiffItem(
  id: string,
  input: {
    itemType: 'change' | 'review';
    itemIndex: number;
    decision: 'approve' | 'reject';
    selectedOption?: string;
  },
  userId?: string
) {
  const db = getDb();
  const whereClause = userId
    ? and(eq(catalogDiffs.id, id), eq(catalogDiffs.userId, userId))
    : eq(catalogDiffs.id, id);
  const [diff] = await db.select().from(catalogDiffs).where(whereClause);
  if (!diff) throw new NotFoundError('CatalogDiff');

  const existing = (diff.userDecisions as any) ?? {};
  const changeDecisions: Record<number, { decision: string; selectedOption?: string }> =
    existing.changeDecisions ?? {};
  const reviewDecisions: Record<number, { decision: string; selectedOption?: string }> =
    existing.reviewDecisions ?? {};
  if (input.itemType === 'change') {
    changeDecisions[input.itemIndex] = {
      decision: input.decision,
      selectedOption: input.selectedOption,
    };
  } else {
    reviewDecisions[input.itemIndex] = {
      decision: input.decision,
      selectedOption: input.selectedOption,
    };
  }
  const decisions = { changeDecisions, reviewDecisions };

  await db.update(catalogDiffs).set({ userDecisions: decisions }).where(eq(catalogDiffs.id, id));

  return { id, updated: true };
}
