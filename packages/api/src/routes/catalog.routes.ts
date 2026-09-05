import { Hono } from 'hono';
import { z } from 'zod';
import {
  listDiffs,
  getDiff,
  applyDiff,
  discardDiff,
  resolveDiffItem,
  generateDiff,
  listCompanies,
  mergeCompanies,
  listJobFitTags,
  listTechStackTags,
  updateJobFitTag,
  updateTechStackTag,
  mergeJobFitTags,
  mergeTechStackTags,
  listBullets,
  listStarEntries,
  listThemes,
} from '../services/catalog.service.js';
import {
  analyzeJobFit,
  getJobFitAnalysis,
  jobFitAnalysesScope,
  listJobFitAnalyses,
} from '../services/job-fit.service.js';
import { requireOwner } from './require-owner.js';
import type { AppEnv } from '../types/env.js';
import { readJsonBody } from '../lib/request.js';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(500).optional(),
});

const listDiffsSchema = paginationSchema.extend({
  status: z.enum(['pending', 'approved', 'rejected', 'partial', 'expired']).optional(),
});

const generateDiffSchema = z.object({
  sourceType: z.enum(['resume', 'application']),
  sourceId: z.string().min(1).max(100),
});

const applyDiffSchema = z.object({
  action: z.enum(['approve_all', 'reject_all', 'partial']),
  decisions: z
    .array(z.object({ changeIndex: z.number().int().min(0), approved: z.boolean() }))
    .max(500)
    .optional(),
  reviewDecisions: z
    .array(
      z.object({
        reviewIndex: z.number().int().min(0),
        selectedOption: z.string().max(200).optional(),
        action: z.enum(['resolve', 'skip', 'create_new']),
      })
    )
    .max(500)
    .optional(),
});

const resolveDiffItemSchema = z.object({
  itemType: z.enum(['change', 'review']),
  itemIndex: z.number().int().min(0),
  decision: z.enum(['approve', 'reject']),
  selectedOption: z.string().max(200).optional(),
});

const listCompaniesSchema = paginationSchema.extend({
  search: z.string().max(200).optional(),
  includeDeleted: z.coerce.boolean().optional(),
});

const mergeEntitiesSchema = z.object({
  sourceCompanyIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  targetCompanyId: z.string().min(1).max(100),
});

const mergeTagsSchema = z.object({
  sourceTagIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  targetTagId: z.string().min(1).max(100),
});

const listTagsSchema = paginationSchema.extend({
  category: z.string().max(100).optional(),
  needsReview: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
});

const jobFitCategoryValues = [
  'role',
  'industry',
  'seniority',
  'work_style',
  'uncategorized',
] as const;
const techStackCategoryValues = [
  'language',
  'frontend',
  'backend',
  'database',
  'cloud',
  'devops',
  'ai_ml',
  'uncategorized',
] as const;

const updateJobFitTagSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  category: z.enum(jobFitCategoryValues).optional(),
  needsReview: z.boolean().optional(),
  version: z.number().int().positive(),
});

const updateTechStackTagSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  category: z.enum(techStackCategoryValues).optional(),
  needsReview: z.boolean().optional(),
  version: z.number().int().positive(),
});

const listBulletsSchema = paginationSchema.extend({
  impactCategory: z.string().max(100).optional(),
  sourceId: z.string().max(100).optional(),
});

const listThemesSchema = paginationSchema.extend({
  coreOnly: z.coerce.boolean().optional(),
  includeHistorical: z.coerce.boolean().optional(),
});

const analyzeJobFitSchema = z
  .object({
    jobDescriptionText: z.string().min(50).max(50000).optional(),
    jobDescriptionUrl: z.string().url().max(2048).optional(),
    // Not part of the xor refinement below: the application this analysis is
    // about is orthogonal to which form the job description arrived in.
    // `.min(1)` so `''` is a 400 here rather than an id that reaches the
    // service and has to be told apart from "absent" (WIC-1818).
    applicationId: z.string().min(1).max(100).optional(),
  })
  .refine(
    (data) => {
      const hasText = data.jobDescriptionText !== undefined && data.jobDescriptionText !== '';
      const hasUrl = data.jobDescriptionUrl !== undefined && data.jobDescriptionUrl !== '';
      return (hasText && !hasUrl) || (!hasText && hasUrl);
    },
    { message: 'Provide either jobDescriptionText or jobDescriptionUrl, not both or neither' }
  );

const listJobFitAnalysesSchema = z.object({
  applicationId: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Same bounds as the `applicationId` filter above. Unlike the `?jobFitAnalysisId=` case one
// line down, `min(1)` here is not closing a live hole — the router never matches an empty
// path segment, and an empty id would in any case narrow to zero rows rather than to all of
// them. `max(100)` is the one that does work: it rejects an over-long segment before it
// reaches the database instead of after (WIC-2058).
const jobFitAnalysisIdSchema = z.object({ id: z.string().min(1).max(100) });

// `min(1)` is load-bearing, not boilerplate: `?jobFitAnalysisId=` arrives as `''`, and a bare
// `z.string().optional()` would accept it and hand the service a supplied-but-unresolvable id
// (WIC-1818). Rejecting it here makes the empty case a 400 rather than a silent no-op.
const listStarEntriesSchema = z.object({
  jobFitAnalysisId: z.string().min(1).max(100).optional(),
});

export const catalogRoutes = new Hono<AppEnv>()
  // ── Diffs ──────────────────────────────────────────────────────────────────
  .get('/catalog/diffs', async (c) => {
    const parsed = listDiffsSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    return c.json(await listDiffs(parsed.data, c.get('userId') ?? undefined));
  })
  .get('/catalog/diffs/:id', async (c) => {
    const diff = await getDiff(c.req.param('id'), requireOwner(c));
    return c.json(diff);
  })
  .post('/catalog/generate-diff', async (c) => {
    const parsed = generateDiffSchema.safeParse(await readJsonBody(c));
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const diff = await generateDiff(parsed.data.sourceType, parsed.data.sourceId, requireOwner(c));
    return c.json(diff, 201);
  })
  .post('/catalog/diffs/:id/apply', async (c) => {
    const parsed = applyDiffSchema.safeParse(await readJsonBody(c));
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const result = await applyDiff(c.req.param('id'), parsed.data, requireOwner(c));
    return c.json(result);
  })
  .delete('/catalog/diffs/:id', async (c) => {
    await discardDiff(c.req.param('id'), requireOwner(c));
    return c.body(null, 204);
  })
  .post('/catalog/diffs/:id/resolve', async (c) => {
    const parsed = resolveDiffItemSchema.safeParse(await readJsonBody(c));
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const result = await resolveDiffItem(c.req.param('id'), parsed.data, requireOwner(c));
    return c.json(result);
  })
  // ── Companies ──────────────────────────────────────────────────────────────
  .get('/catalog/companies', async (c) => {
    const parsed = listCompaniesSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    return c.json(await listCompanies(parsed.data, c.get('userId') ?? undefined));
  })
  .post('/catalog/companies/merge', async (c) => {
    const parsed = mergeEntitiesSchema.safeParse(await readJsonBody(c));
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const result = await mergeCompanies(
      parsed.data.sourceCompanyIds,
      parsed.data.targetCompanyId,
      requireOwner(c)
    );
    return c.json(result);
  })
  // ── Tags ───────────────────────────────────────────────────────────────────
  .get('/catalog/tags/:type', async (c) => {
    const type = c.req.param('type');
    const parsed = listTagsSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);

    if (type === 'job-fit') {
      if (
        parsed.data.category &&
        !jobFitCategoryValues.includes(
          parsed.data.category as (typeof jobFitCategoryValues)[number]
        )
      ) {
        return c.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid job-fit category. Valid values: ${jobFitCategoryValues.join(', ')}`,
            },
          },
          400
        );
      }
      return c.json(await listJobFitTags(parsed.data, c.get('userId') ?? undefined));
    } else if (type === 'tech-stack') {
      if (
        parsed.data.category &&
        !techStackCategoryValues.includes(
          parsed.data.category as (typeof techStackCategoryValues)[number]
        )
      ) {
        return c.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid tech-stack category. Valid values: ${techStackCategoryValues.join(', ')}`,
            },
          },
          400
        );
      }
      return c.json(await listTechStackTags(parsed.data, c.get('userId') ?? undefined));
    } else {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } },
        400
      );
    }
  })
  .post('/catalog/tags/:type/merge', async (c) => {
    const type = c.req.param('type');
    const parsed = mergeTagsSchema.safeParse(await readJsonBody(c));
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);

    if (type === 'job-fit') {
      return c.json(
        await mergeJobFitTags(parsed.data.sourceTagIds, parsed.data.targetTagId, requireOwner(c))
      );
    } else if (type === 'tech-stack') {
      return c.json(
        await mergeTechStackTags(parsed.data.sourceTagIds, parsed.data.targetTagId, requireOwner(c))
      );
    } else {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } },
        400
      );
    }
  })
  .patch('/catalog/tags/:type/:id', async (c) => {
    const type = c.req.param('type');
    const id = c.req.param('id');

    if (type === 'job-fit') {
      const parsed = updateJobFitTagSchema.safeParse(await readJsonBody(c));
      if (!parsed.success)
        return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
      const tag = await updateJobFitTag(id, parsed.data, requireOwner(c));
      return c.json(tag);
    } else if (type === 'tech-stack') {
      const parsed = updateTechStackTagSchema.safeParse(await readJsonBody(c));
      if (!parsed.success)
        return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
      const tag = await updateTechStackTag(id, parsed.data, requireOwner(c));
      return c.json(tag);
    } else {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } },
        400
      );
    }
  })
  // ── Quantified bullets ─────────────────────────────────────────────────────
  .get('/catalog/quantified-bullets', async (c) => {
    const parsed = listBulletsSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    return c.json(await listBullets(parsed.data, c.get('userId') ?? undefined));
  })
  // ── STAR Catalog Entries ───────────────────────────────────────────────────
  .get('/star-entries', async (c) => {
    const parsed = listStarEntriesSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const entries = await listStarEntries(
      c.get('userId') ?? undefined,
      parsed.data.jobFitAnalysisId
    );
    return c.json({ entries });
  })
  // ── Themes ─────────────────────────────────────────────────────────────────
  .get('/catalog/themes', async (c) => {
    const parsed = listThemesSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    return c.json(await listThemes(parsed.data, c.get('userId') ?? undefined));
  })
  // ── Job Fit Analysis ────────────────────────────────────────────────────────
  .post('/catalog/job-fit/analyze', async (c) => {
    const parsed = analyzeJobFitSchema.safeParse(await readJsonBody(c));
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);

    const clientIp =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0] ||
      'unknown';
    // `clientIp` is the rate-limit bucket key, not an identity. The catalog reads
    // are scoped by the caller id, which every sibling route on this router
    // already threads (WIC-1435).
    const { response, rateLimitHeaders } = await analyzeJobFit(
      parsed.data,
      clientIp,
      c.get('userId') ?? undefined
    );

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rateLimitHeaders.remaining),
        'X-RateLimit-Reset': String(rateLimitHeaders.reset),
      },
    });
  })
  // The read half of UC-3 persistence (WIC-1652). Without this, an analysis is
  // stored but unfindable, so `ApplicationDetail` still could not tell whether
  // an application has been analysed.
  .get('/catalog/job-fit/analyses', async (c) => {
    const parsed = listJobFitAnalysesSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);

    const result = await listJobFitAnalyses(
      parsed.data,
      jobFitAnalysesScope(c.get('userId') ?? undefined)
    );
    return c.json(result);
  })
  /**
   * One stored analysis, by id (WIC-2058).
   *
   * Declared after the collection route above; the two paths are distinct, so ordering is
   * not load-bearing here, but keeping the pair adjacent is.
   *
   * The 404 is deliberately indiscriminate. `getJobFitAnalysis` ANDs the owner term into
   * the read, so it returns `null` for an id that does not exist *and* for one that
   * belongs to somebody else — and this handler cannot tell them apart, which is the
   * point. Distinguishing them would turn the endpoint into an existence oracle over
   * other users' ids.
   */
  .get('/catalog/job-fit/analyses/:id', async (c) => {
    const parsed = jobFitAnalysisIdSchema.safeParse({ id: c.req.param('id') });
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);

    const analysis = await getJobFitAnalysis(
      parsed.data.id,
      jobFitAnalysesScope(c.get('userId') ?? undefined)
    );

    if (!analysis)
      return c.json(
        { error: { code: 'JOB_FIT_ANALYSIS_NOT_FOUND', message: 'Job fit analysis not found' } },
        404
      );

    return c.json({ analysis });
  });
