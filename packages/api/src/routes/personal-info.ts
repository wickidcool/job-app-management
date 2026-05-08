import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types/env.js';
import * as personalInfoService from '../services/personal-info.service.js';

const upsertSchema = z.object({
  fullName: z.string().max(200).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  linkedinUrl: z.string().url().max(500).nullable().optional(),
  githubUrl: z.string().url().max(500).nullable().optional(),
  homeAddress: z.string().max(500).nullable().optional(),
  phoneNumber: z.string().max(50).nullable().optional(),
  projectsWebsite: z.string().url().max(500).nullable().optional(),
  publishingPlatforms: z.array(z.string().url().max(500)).optional(),
  version: z.number().int().positive().optional(),
});

export const personalInfoRoutes = new Hono<AppEnv>()
  .get('/personal-info', async (c) => {
    const result = await personalInfoService.getPersonalInfo(c.get('userId') ?? undefined);
    return c.json({ personalInfo: result });
  })
  .put('/personal-info', async (c) => {
    const body = upsertSchema.safeParse(await c.req.json());
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
    const result = await personalInfoService.upsertPersonalInfo(
      body.data,
      c.get('userId') ?? undefined
    );
    return c.json({ personalInfo: result });
  });
