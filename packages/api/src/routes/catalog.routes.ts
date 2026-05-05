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
import { analyzeJobFit } from '../services/job-fit.service.js';
import type { AppEnv } from '../types/env.js';

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
  })
  .refine(
    (data) => {
      const hasText = data.jobDescriptionText !== undefined && data.jobDescriptionText !== '';
      const hasUrl = data.jobDescriptionUrl !== undefined && data.jobDescriptionUrl !== '';
      return (hasText && !hasUrl) || (!hasText && hasUrl);
    },
    { message: 'Provide either jobDescriptionText or jobDescriptionUrl, not both or neither' }
  );

export const catalogRoutes = new Hono<AppEnv>()
  // ── Diffs ──────────────────────────────────────────────────────────────────
  .get('/catalog/diffs', async (c) => {
    const parsed = listDiffsSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const { diffs } = await listDiffs(parsed.data, c.get('userId') ?? undefined);
    return c.json(diffs);
  })
  .get('/catalog/diffs/:id', async (c) => {
    const diff = await getDiff(c.req.param('id'), c.get('userId') ?? undefined);
    return c.json(diff);
  })
  .post('/catalog/generate-diff', async (c) => {
    const parsed = generateDiffSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const diff = await generateDiff(
      parsed.data.sourceType,
      parsed.data.sourceId,
      c.get('userId') ?? undefined
    );
    return c.json(diff, 201);
  })
  .post('/catalog/diffs/:id/apply', async (c) => {
    const parsed = applyDiffSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const result = await applyDiff(c.req.param('id'), parsed.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .delete('/catalog/diffs/:id', async (c) => {
    await discardDiff(c.req.param('id'), c.get('userId') ?? undefined);
    return c.body(null, 204);
  })
  .post('/catalog/diffs/:id/resolve', async (c) => {
    const parsed = resolveDiffItemSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const result = await resolveDiffItem(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  })
  // ── Companies ──────────────────────────────────────────────────────────────
  .get('/catalog/companies', async (c) => {
    const parsed = listCompaniesSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const { companies } = await listCompanies(parsed.data, c.get('userId') ?? undefined);
    return c.json(companies);
  })
  .post('/catalog/companies/merge', async (c) => {
    const parsed = mergeEntitiesSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const result = await mergeCompanies(
      parsed.data.sourceCompanyIds,
      parsed.data.targetCompanyId,
      c.get('userId') ?? undefined
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
      const { tags } = await listJobFitTags(parsed.data, c.get('userId') ?? undefined);
      return c.json(tags);
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
      const { tags } = await listTechStackTags(parsed.data, c.get('userId') ?? undefined);
      return c.json(tags);
    } else {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } },
        400
      );
    }
  })
  .post('/catalog/tags/:type/merge', async (c) => {
    const type = c.req.param('type');
    const parsed = mergeTagsSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);

    if (type === 'job-fit') {
      return c.json(
        await mergeJobFitTags(
          parsed.data.sourceTagIds,
          parsed.data.targetTagId,
          c.get('userId') ?? undefined
        )
      );
    } else if (type === 'tech-stack') {
      return c.json(
        await mergeTechStackTags(
          parsed.data.sourceTagIds,
          parsed.data.targetTagId,
          c.get('userId') ?? undefined
        )
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
      const parsed = updateJobFitTagSchema.safeParse(await c.req.json());
      if (!parsed.success)
        return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
      const tag = await updateJobFitTag(id, parsed.data, c.get('userId') ?? undefined);
      return c.json(tag);
    } else if (type === 'tech-stack') {
      const parsed = updateTechStackTagSchema.safeParse(await c.req.json());
      if (!parsed.success)
        return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
      const tag = await updateTechStackTag(id, parsed.data, c.get('userId') ?? undefined);
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
    const { bullets } = await listBullets(parsed.data, c.get('userId') ?? undefined);
    return c.json(bullets);
  })
  // ── STAR Catalog Entries ───────────────────────────────────────────────────
  .get('/star-entries', async (c) => {
    const entries = await listStarEntries(c.get('userId') ?? undefined);
    return c.json({ entries });
  })
  // ── Themes ─────────────────────────────────────────────────────────────────
  .get('/catalog/themes', async (c) => {
    const parsed = listThemesSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    const { themes } = await listThemes(parsed.data, c.get('userId') ?? undefined);
    return c.json(themes);
  })
  // ── Job Fit Analysis ────────────────────────────────────────────────────────
  .post('/catalog/job-fit/analyze', async (c) => {
    const parsed = analyzeJobFitSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);

    const clientIp =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0] ||
      'unknown';
    const { response, rateLimitHeaders } = await analyzeJobFit(parsed.data, clientIp);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rateLimitHeaders.remaining),
        'X-RateLimit-Reset': String(rateLimitHeaders.reset),
      },
    });
  });
