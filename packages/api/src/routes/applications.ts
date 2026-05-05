import { Hono } from 'hono';
import { z } from 'zod';
import {
  createApplication,
  getApplication,
  listApplications,
  updateApplication,
  deleteApplication,
  updateApplicationStatus,
} from '../services/application.service.js';
import type { AppEnv } from '../types/env.js';

const applicationStatusEnum = z.enum([
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
]);

const createApplicationSchema = z.object({
  jobTitle: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  url: z.string().url().or(z.literal('')).optional(),
  location: z.string().min(1).max(100).optional(),
  salaryRange: z.string().min(1).max(50).optional(),
  status: applicationStatusEnum.optional(),
  coverLetterId: z.string().optional(),
  resumeVersionId: z.string().optional(),
  contact: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  compTarget: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  nextAction: z
    .string()
    .max(500)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  nextActionDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(''))
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  jobDescription: z
    .string()
    .max(50000)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});

const updateApplicationSchema = z.object({
  jobTitle: z.string().min(1).max(200).optional(),
  company: z.string().min(1).max(200).optional(),
  url: z.string().url().or(z.literal('')).nullable().optional(),
  location: z.string().min(1).max(100).nullable().optional(),
  salaryRange: z.string().min(1).max(50).nullable().optional(),
  coverLetterId: z.string().nullable().optional(),
  resumeVersionId: z.string().nullable().optional(),
  contact: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  compTarget: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  nextAction: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  nextActionDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  jobDescription: z
    .string()
    .max(50000)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  version: z.number().int().positive(),
});

const updateStatusSchema = z.object({
  status: applicationStatusEnum,
  note: z.string().min(1).max(500).optional(),
  version: z.number().int().positive(),
});

const listQuerySchema = z.object({
  status: z.string().optional(),
  company: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'company']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.string().optional(),
});

export const applicationsRoutes = new Hono<AppEnv>()
  .get('/applications', async (c) => {
    const query = listQuerySchema.safeParse(c.req.query());
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
    const result = await listApplications(query.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/applications/:id', async (c) => {
    const result = await getApplication(c.req.param('id'), c.get('userId') ?? undefined);
    return c.json(result);
  })
  .post('/applications', async (c) => {
    const body = createApplicationSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: body.error.flatten(),
          },
        },
        400
      );
    }
    const result = await createApplication(body.data, c.get('userId') ?? undefined);
    return c.json(result, 201);
  })
  .patch('/applications/:id', async (c) => {
    const body = updateApplicationSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: body.error.flatten(),
          },
        },
        400
      );
    }
    const result = await updateApplication(
      c.req.param('id'),
      body.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  })
  .delete('/applications/:id', async (c) => {
    await deleteApplication(c.req.param('id'), c.get('userId') ?? undefined);
    return c.body(null, 204);
  })
  .post('/applications/:id/status', async (c) => {
    const body = updateStatusSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: body.error.flatten(),
          },
        },
        400
      );
    }
    const result = await updateApplicationStatus(
      c.req.param('id'),
      body.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  });
