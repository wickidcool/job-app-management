import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getPipelineReport,
  getNeedsActionReport,
  getStaleReport,
  getClosedLoopReport,
  getByFitTierReport,
} from '../services/reports.service.js';
import { AppError } from '../types/index.js';

const pipelineQuerySchema = z.object({
  sortBy: z.enum(['updatedAt', 'createdAt', 'company']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const needsActionQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  includeOverdue: z.enum(['true', 'false']).optional().transform((v) => v !== 'false'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const staleQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const closedLoopQuerySchema = z.object({
  period: z.enum(['30d', '60d', '90d', 'all']).optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const byFitTierQuerySchema = z.object({
  includeTerminal: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  sortBy: z.enum(['updatedAt', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export async function reportsRoutes(fastify: FastifyInstance) {
  // GET /api/reports/pipeline
  fastify.get('/reports/pipeline', async (request, reply) => {
    const query = pipelineQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: query.error.flatten() },
      });
    }
    const result = await getPipelineReport(query.data);
    return reply.send(result);
  });

  // GET /api/reports/needs-action
  fastify.get('/reports/needs-action', async (request, reply) => {
    const query = needsActionQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: query.error.flatten() },
      });
    }
    const result = await getNeedsActionReport(query.data);
    return reply.send(result);
  });

  // GET /api/reports/stale
  fastify.get('/reports/stale', async (request, reply) => {
    const query = staleQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: query.error.flatten() },
      });
    }
    const result = await getStaleReport(query.data);
    return reply.send(result);
  });

  // GET /api/reports/closed-loop
  fastify.get('/reports/closed-loop', async (request, reply) => {
    const query = closedLoopQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: query.error.flatten() },
      });
    }
    const result = await getClosedLoopReport(query.data);
    return reply.send(result);
  });

  // GET /api/reports/by-fit-tier
  fastify.get('/reports/by-fit-tier', async (request, reply) => {
    const query = byFitTierQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: query.error.flatten() },
      });
    }
    const result = await getByFitTierReport(query.data);
    return reply.send(result);
  });
}
