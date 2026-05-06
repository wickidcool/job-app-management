import { Hono } from 'hono';
import { z } from 'zod';
import {
  getPipelineReport,
  getNeedsActionReport,
  getStaleReport,
  getClosedLoopReport,
  getByFitTierReport,
} from '../services/reports.service.js';
import type { AppEnv } from '../types/env.js';

const pipelineQuerySchema = z.object({
  sortBy: z.enum(['updatedAt', 'createdAt', 'company']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const needsActionQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  includeOverdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const VALID_APP_STATUSES = [
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const;

const VALID_TERMINAL_STATUSES = ['offer', 'rejected', 'withdrawn'] as const;

const staleQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  status: z
    .string()
    .optional()
    .refine(
      (s) => {
        if (!s) return true;
        return s
          .split(',')
          .map((v) => v.trim())
          .every((v) => (VALID_APP_STATUSES as readonly string[]).includes(v));
      },
      { message: 'Invalid status value(s). Must be comma-separated list of valid statuses.' }
    ),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const closedLoopQuerySchema = z.object({
  period: z.enum(['30d', '60d', '90d', 'all']).optional(),
  status: z
    .string()
    .optional()
    .refine(
      (s) => {
        if (!s) return true;
        return s
          .split(',')
          .map((v) => v.trim())
          .every((v) => (VALID_TERMINAL_STATUSES as readonly string[]).includes(v));
      },
      {
        message:
          'Invalid status value(s). Must be comma-separated list of: offer, rejected, withdrawn.',
      }
    ),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const byFitTierQuerySchema = z.object({
  includeTerminal: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sortBy: z.enum(['updatedAt', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const reportsRoutes = new Hono<AppEnv>()
  .get('/reports/pipeline', async (c) => {
    const query = pipelineQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: query.error.flatten(),
          },
        },
        400
      );
    }
    const result = await getPipelineReport(query.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/reports/needs-action', async (c) => {
    const query = needsActionQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: query.error.flatten(),
          },
        },
        400
      );
    }
    const result = await getNeedsActionReport(query.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/reports/stale', async (c) => {
    const query = staleQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: query.error.flatten(),
          },
        },
        400
      );
    }
    const result = await getStaleReport(query.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/reports/closed-loop', async (c) => {
    const query = closedLoopQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: query.error.flatten(),
          },
        },
        400
      );
    }
    const result = await getClosedLoopReport(query.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/reports/by-fit-tier', async (c) => {
    const query = byFitTierQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: query.error.flatten(),
          },
        },
        400
      );
    }
    const result = await getByFitTierReport(query.data, c.get('userId') ?? undefined);
    return c.json(result);
  });
