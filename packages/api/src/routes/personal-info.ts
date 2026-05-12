import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types/env.js';
import * as personalInfoService from '../services/personal-info.service.js';

const urlSchema = z.string().url().max(500).nullable().optional();

const updatePersonalInfoSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().min(1).max(30).nullable().optional(),
  addressLine1: z.string().min(1).max(200).nullable().optional(),
  addressLine2: z.string().min(1).max(200).nullable().optional(),
  city: z.string().min(1).max(100).nullable().optional(),
  state: z.string().min(1).max(100).nullable().optional(),
  postalCode: z.string().min(1).max(20).nullable().optional(),
  country: z.string().min(1).max(100).nullable().optional(),
  linkedinUrl: urlSchema,
  githubUrl: urlSchema,
  portfolioUrl: urlSchema,
  websiteUrl: urlSchema,
  professionalSummary: z.string().min(1).max(2000).nullable().optional(),
  headline: z.string().min(1).max(100).nullable().optional(),
  version: z.number().int().positive().optional(),
});

export const personalInfoRoutes = new Hono<AppEnv>()
  .get('/personal-info', async (c) => {
    const result = await personalInfoService.getPersonalInfo(c.get('userId') ?? undefined);
    return c.json(result);
  })
  .patch('/personal-info', async (c) => {
    const body = updatePersonalInfoSchema.safeParse(await c.req.json());
    if (!body.success) {
      const firstError = body.error.errors[0];
      if (firstError?.path.some((p) => ['email'].includes(String(p)))) {
        return c.json(
          {
            error: {
              code: 'INVALID_EMAIL',
              message: 'Email format invalid',
              details: body.error.flatten(),
            },
          },
          400
        );
      }
      if (
        firstError?.path.some((p) =>
          ['linkedinUrl', 'githubUrl', 'portfolioUrl', 'websiteUrl'].includes(String(p))
        )
      ) {
        return c.json(
          {
            error: {
              code: 'INVALID_URL',
              message: 'URL format invalid',
              details: body.error.flatten(),
            },
          },
          400
        );
      }
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
    const result = await personalInfoService.upsertPersonalInfo(
      body.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  });
