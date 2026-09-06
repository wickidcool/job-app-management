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
import { readJsonBody } from '../lib/request.js';
import { requireOwner } from './require-owner.js';

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
  // WIC-2023. `datetime({ offset: true })`, not the `^\d{4}-\d{2}-\d{2}$` regex
  // `nextActionDue` uses: the column is TIMESTAMPTZ and the service feeds this
  // straight to `new Date(...)`. The regex would admit a date-only string that
  // `new Date` reads as UTC midnight, silently shifting the instant.
  interviewDate: z
    .string()
    .datetime({ offset: true })
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
  // WIC-2023. See the create schema above for why this is `datetime`, not the
  // date-only regex. `.nullable()` is what lets a caller clear a scheduled date.
  interviewDate: z
    .string()
    .datetime({ offset: true })
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

// WIC-2189. Same `datetime({ offset: true })` contract as the create/update
// schemas above, and for the same reason: `interview_date` is TIMESTAMPTZ and
// the service hands these to `new Date(...)`. A date-only bound would be read
// as UTC midnight, moving the window by up to a day for any caller west of
// Greenwich — the identical hazard documented at :54-57, arriving through a
// query string instead of a body.
//
// The `'' -> undefined` transform matches the sibling fields: a client that
// builds `?interviewDateFrom=` from an empty form control means "no bound", not
// "a bound I could not parse".
const interviewDateBound = z
  .string()
  .datetime({ offset: true })
  .or(z.literal(''))
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const listQuerySchema = z
  .object({
    status: z.string().optional(),
    company: z.string().optional(),
    search: z.string().optional(),
    interviewDateFrom: interviewDateBound,
    interviewDateTo: interviewDateBound,
    sortBy: z.enum(['createdAt', 'updatedAt', 'company', 'interviewDate']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    page: z.string().optional(),
  })
  // An inverted range is a client bug, and the honest failure is loud. Left to
  // the database it is a silent empty page, which reads exactly like "you have
  // no interviews scheduled" — a wrong answer the caller cannot distinguish
  // from a right one.
  .refine(
    (q) =>
      !q.interviewDateFrom ||
      !q.interviewDateTo ||
      new Date(q.interviewDateFrom) <= new Date(q.interviewDateTo),
    {
      message: 'interviewDateFrom must be less than or equal to interviewDateTo',
      path: ['interviewDateFrom'],
    }
  );

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
    const result = await listApplications(query.data, requireOwner(c));
    return c.json(result);
  })
  .get('/applications/:id', async (c) => {
    const result = await getApplication(c.req.param('id'), requireOwner(c));
    return c.json(result);
  })
  .post('/applications', async (c) => {
    const body = createApplicationSchema.safeParse(await readJsonBody(c));
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
    const result = await createApplication(body.data, requireOwner(c));
    return c.json(result, 201);
  })
  .patch('/applications/:id', async (c) => {
    const body = updateApplicationSchema.safeParse(await readJsonBody(c));
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
    const result = await updateApplication(c.req.param('id'), body.data, requireOwner(c));
    return c.json(result);
  })
  .delete('/applications/:id', async (c) => {
    await deleteApplication(c.req.param('id'), requireOwner(c));
    return c.body(null, 204);
  })
  .post('/applications/:id/status', async (c) => {
    const body = updateStatusSchema.safeParse(await readJsonBody(c));
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
    const result = await updateApplicationStatus(c.req.param('id'), body.data, requireOwner(c));
    return c.json(result);
  });
