import type { FastifyInstance } from 'fastify';
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
  listThemes,
} from '../services/catalog.service.js';
import { analyzeJobFit } from '../services/job-fit.service.js';

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

export async function catalogRoutes(fastify: FastifyInstance) {
  // ── Diffs ──────────────────────────────────────────────────────────────────

  fastify.get('/catalog/diffs', async (request, reply) => {
    const parsed = listDiffsSchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const { diffs } = await listDiffs(parsed.data);
    return reply.send(diffs);
  });

  fastify.get<{ Params: { id: string } }>('/catalog/diffs/:id', async (request, reply) => {
    const diff = await getDiff(request.params.id);
    return reply.send(diff);
  });

  fastify.post('/catalog/generate-diff', async (request, reply) => {
    const parsed = generateDiffSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const diff = await generateDiff(parsed.data.sourceType, parsed.data.sourceId);
    return reply.status(201).send(diff);
  });

  fastify.post<{ Params: { id: string } }>('/catalog/diffs/:id/apply', async (request, reply) => {
    const parsed = applyDiffSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const result = await applyDiff(request.params.id, parsed.data);
    return reply.send(result);
  });

  fastify.delete<{ Params: { id: string } }>('/catalog/diffs/:id', async (request, reply) => {
    await discardDiff(request.params.id);
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/catalog/diffs/:id/resolve', async (request, reply) => {
    const parsed = resolveDiffItemSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const result = await resolveDiffItem(request.params.id, parsed.data);
    return reply.send(result);
  });

  // ── Companies ──────────────────────────────────────────────────────────────

  fastify.get('/catalog/companies', async (request, reply) => {
    const parsed = listCompaniesSchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const { companies } = await listCompanies(parsed.data);
    return reply.send(companies);
  });

  fastify.post('/catalog/companies/merge', async (request, reply) => {
    const parsed = mergeEntitiesSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const result = await mergeCompanies(parsed.data.sourceCompanyIds, parsed.data.targetCompanyId);
    return reply.send(result);
  });

  // ── Tags ───────────────────────────────────────────────────────────────────

  fastify.get<{ Params: { type: string } }>('/catalog/tags/:type', async (request, reply) => {
    const { type } = request.params;
    const parsed = listTagsSchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });

    if (type === 'job-fit') {
      if (
        parsed.data.category &&
        !jobFitCategoryValues.includes(
          parsed.data.category as (typeof jobFitCategoryValues)[number]
        )
      ) {
        return reply
          .status(400)
          .send({
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid job-fit category. Valid values: ${jobFitCategoryValues.join(', ')}`,
            },
          });
      }
      const { tags } = await listJobFitTags(parsed.data);
      return reply.send(tags);
    } else if (type === 'tech-stack') {
      if (
        parsed.data.category &&
        !techStackCategoryValues.includes(
          parsed.data.category as (typeof techStackCategoryValues)[number]
        )
      ) {
        return reply
          .status(400)
          .send({
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid tech-stack category. Valid values: ${techStackCategoryValues.join(', ')}`,
            },
          });
      }
      const { tags } = await listTechStackTags(parsed.data);
      return reply.send(tags);
    } else {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } });
    }
  });

  fastify.post<{ Params: { type: string } }>(
    '/catalog/tags/:type/merge',
    async (request, reply) => {
      const { type } = request.params;
      const parsed = mergeTagsSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .status(400)
          .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });

      if (type === 'job-fit') {
        return reply.send(await mergeJobFitTags(parsed.data.sourceTagIds, parsed.data.targetTagId));
      } else if (type === 'tech-stack') {
        return reply.send(
          await mergeTechStackTags(parsed.data.sourceTagIds, parsed.data.targetTagId)
        );
      } else {
        return reply
          .status(400)
          .send({ error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } });
      }
    }
  );

  fastify.patch<{ Params: { type: string; id: string } }>(
    '/catalog/tags/:type/:id',
    async (request, reply) => {
      const { type, id } = request.params;

      if (type === 'job-fit') {
        const parsed = updateJobFitTagSchema.safeParse(request.body);
        if (!parsed.success)
          return reply
            .status(400)
            .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
        const tag = await updateJobFitTag(id, parsed.data);
        return reply.send(tag);
      } else if (type === 'tech-stack') {
        const parsed = updateTechStackTagSchema.safeParse(request.body);
        if (!parsed.success)
          return reply
            .status(400)
            .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
        const tag = await updateTechStackTag(id, parsed.data);
        return reply.send(tag);
      } else {
        return reply
          .status(400)
          .send({ error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } });
      }
    }
  );

  // ── Quantified bullets ─────────────────────────────────────────────────────

  fastify.get('/catalog/quantified-bullets', async (request, reply) => {
    const parsed = listBulletsSchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const { bullets } = await listBullets(parsed.data);
    return reply.send(bullets);
  });

  // ── Themes ─────────────────────────────────────────────────────────────────

  fastify.get('/catalog/themes', async (request, reply) => {
    const parsed = listThemesSchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    const { themes } = await listThemes(parsed.data);
    return reply.send(themes);
  });

  // ── Job Fit Analysis ────────────────────────────────────────────────────────

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

  fastify.post('/catalog/job-fit/analyze', async (request, reply) => {
    const parsed = analyzeJobFitSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });

    const clientIp =
      request.ip || request.headers['x-forwarded-for']?.toString().split(',')[0] || 'unknown';
    const { response, rateLimitHeaders } = await analyzeJobFit(parsed.data, clientIp);

    reply.header('X-RateLimit-Remaining', String(rateLimitHeaders.remaining));
    reply.header('X-RateLimit-Reset', String(rateLimitHeaders.reset));

    return reply.send(response);
  });
}
