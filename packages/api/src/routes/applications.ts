import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createApplication,
  getApplication,
  listApplications,
  updateApplication,
  deleteApplication,
  updateApplicationStatus,
} from '../services/application.service.js';
import { ALL_STATUSES } from '../services/status.service.js';
import { AppError } from '../types/index.js';

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
  // UC-5 Extended Tracking Fields
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
  // UC-5 Extended Tracking Fields
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

export async function applicationsRoutes(fastify: FastifyInstance) {
  // GET /api/applications
  fastify.get('/applications', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: query.error.flatten(),
        },
      });
    }
    const result = await listApplications(query.data, request.userId ?? undefined);
    return reply.send(result);
  });

  // GET /api/applications/:id
  fastify.get<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await getApplication(id, request.userId ?? undefined);
    return reply.send(result);
  });

  // POST /api/applications
  fastify.post('/applications', async (request, reply) => {
    const body = createApplicationSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: body.error.flatten(),
        },
      });
    }
    const result = await createApplication(body.data, request.userId ?? undefined);
    return reply.status(201).send(result);
  });

  // PATCH /api/applications/:id
  fastify.patch<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const { id } = request.params;
    const body = updateApplicationSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: body.error.flatten(),
        },
      });
    }
    const result = await updateApplication(id, body.data, request.userId ?? undefined);
    return reply.send(result);
  });

  // DELETE /api/applications/:id
  fastify.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const { id } = request.params;
    await deleteApplication(id, request.userId ?? undefined);
    return reply.status(204).send();
  });

  // POST /api/applications/:id/status
  fastify.post<{ Params: { id: string } }>('/applications/:id/status', async (request, reply) => {
    const { id } = request.params;
    const body = updateStatusSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: body.error.flatten(),
        },
      });
    }
    const result = await updateApplicationStatus(id, body.data, request.userId ?? undefined);
    return reply.send(result);
  });
}
