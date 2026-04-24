import type { FastifyInstance } from 'fastify';
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

export async function catalogRoutes(fastify: FastifyInstance) {
  // ── Diffs ──────────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { status?: string; limit?: string; cursor?: string } }>(
    '/catalog/diffs',
    async (request, reply) => {
      const { status, limit, cursor } = request.query;
      const { diffs } = await listDiffs({
        status,
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor,
      });
      return reply.send(diffs);
    },
  );

  fastify.get<{ Params: { id: string } }>('/catalog/diffs/:id', async (request, reply) => {
    const diff = await getDiff(request.params.id);
    return reply.send(diff);
  });

  fastify.post<{
    Body: { sourceType: 'resume' | 'application'; sourceId: string };
  }>('/catalog/generate-diff', async (request, reply) => {
    const { sourceType, sourceId } = request.body;
    const diff = await generateDiff(sourceType, sourceId);
    return reply.status(201).send(diff);
  });

  fastify.post<{
    Params: { id: string };
    Body: {
      action: 'approve_all' | 'reject_all' | 'partial';
      decisions?: Array<{ changeIndex: number; approved: boolean }>;
      reviewDecisions?: Array<{
        reviewIndex: number;
        selectedOption?: string;
        action: 'resolve' | 'skip' | 'create_new';
      }>;
    };
  }>('/catalog/diffs/:id/apply', async (request, reply) => {
    const result = await applyDiff(request.params.id, request.body);
    return reply.send(result);
  });

  fastify.delete<{ Params: { id: string } }>('/catalog/diffs/:id', async (request, reply) => {
    await discardDiff(request.params.id);
    return reply.status(204).send();
  });

  fastify.post<{
    Params: { id: string };
    Body: {
      itemType: 'change' | 'review';
      itemIndex: number;
      decision: 'approve' | 'reject';
      selectedOption?: string;
    };
  }>('/catalog/diffs/:id/resolve', async (request, reply) => {
    const result = await resolveDiffItem(request.params.id, request.body);
    return reply.send(result);
  });

  // ── Companies ──────────────────────────────────────────────────────────────

  fastify.get<{
    Querystring: { search?: string; includeDeleted?: string; limit?: string; cursor?: string };
  }>('/catalog/companies', async (request, reply) => {
    const { search, includeDeleted, limit, cursor } = request.query;
    const { companies } = await listCompanies({
      search,
      includeDeleted: includeDeleted === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
    return reply.send(companies);
  });

  fastify.post<{ Body: { sourceCompanyIds: string[]; targetCompanyId: string } }>(
    '/catalog/companies/merge',
    async (request, reply) => {
      const { sourceCompanyIds, targetCompanyId } = request.body;
      const result = await mergeCompanies(sourceCompanyIds, targetCompanyId);
      return reply.send(result);
    },
  );

  // ── Tags ───────────────────────────────────────────────────────────────────

  fastify.get<{
    Params: { type: string };
    Querystring: {
      category?: string;
      needsReview?: string;
      search?: string;
      limit?: string;
      cursor?: string;
    };
  }>('/catalog/tags/:type', async (request, reply) => {
    const { type } = request.params;
    const { category, needsReview, search, limit, cursor } = request.query;
    const opts = {
      category,
      needsReview: needsReview === 'true',
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    };

    if (type === 'job-fit') {
      const { tags } = await listJobFitTags(opts);
      return reply.send(tags);
    } else if (type === 'tech-stack') {
      const { tags } = await listTechStackTags(opts);
      return reply.send(tags);
    } else {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } });
    }
  });

  fastify.post<{
    Params: { type: string };
    Body: { sourceTagIds: string[]; targetTagId: string };
  }>('/catalog/tags/:type/merge', async (request, reply) => {
    const { type } = request.params;
    const { sourceTagIds, targetTagId } = request.body;

    if (type === 'job-fit') {
      return reply.send(await mergeJobFitTags(sourceTagIds, targetTagId));
    } else if (type === 'tech-stack') {
      return reply.send(await mergeTechStackTags(sourceTagIds, targetTagId));
    } else {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } });
    }
  });

  fastify.patch<{
    Params: { type: string; id: string };
    Body: { displayName?: string; category?: string; needsReview?: boolean; version: number };
  }>('/catalog/tags/:type/:id', async (request, reply) => {
    const { type, id } = request.params;

    if (type === 'job-fit') {
      const tag = await updateJobFitTag(id, request.body);
      return reply.send(tag);
    } else if (type === 'tech-stack') {
      const tag = await updateTechStackTag(id, request.body);
      return reply.send(tag);
    } else {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'type must be job-fit or tech-stack' } });
    }
  });

  // ── Quantified bullets ─────────────────────────────────────────────────────

  fastify.get<{
    Querystring: { impactCategory?: string; sourceId?: string; limit?: string; cursor?: string };
  }>('/catalog/quantified-bullets', async (request, reply) => {
    const { impactCategory, sourceId, limit, cursor } = request.query;
    const { bullets } = await listBullets({
      impactCategory,
      sourceId,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
    return reply.send(bullets);
  });

  // ── Themes ─────────────────────────────────────────────────────────────────

  fastify.get<{
    Querystring: {
      coreOnly?: string;
      includeHistorical?: string;
      limit?: string;
      cursor?: string;
    };
  }>('/catalog/themes', async (request, reply) => {
    const { coreOnly, includeHistorical, limit, cursor } = request.query;
    const { themes } = await listThemes({
      coreOnly: coreOnly === 'true',
      includeHistorical: includeHistorical === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
    return reply.send(themes);
  });
}
