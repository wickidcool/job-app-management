import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import {
  generateResumeVariant,
  getResumeVariant,
  listResumeVariants,
  updateResumeVariant,
  deleteResumeVariant,
  reviseResumeVariant,
  suggestBullets,
  exportResumeVariant,
} from '../services/resume-variant.service.js';
import type { AppEnv } from '../types/env.js';

const formatValues = ['chronological', 'functional', 'hybrid'] as const;
const emphasisValues = ['experience_heavy', 'skills_heavy', 'balanced'] as const;
const sectionTypes = [
  'summary',
  'experience',
  'skills',
  'projects',
  'education',
  'certifications',
] as const;

const bulletSelectionSchema = z.object({
  sectionId: z.string().min(1),
  bulletIds: z.array(z.string()).min(1),
});

const generateSchema = z
  .object({
    jobDescriptionText: z.string().min(50).max(50000).optional(),
    jobDescriptionUrl: z.string().url().optional(),
    jobFitAnalysisId: z.string().optional(),
    targetCompany: z.string().min(1).max(200).optional(),
    targetRole: z.string().min(1).max(200).optional(),
    baseResumeId: z.string().optional(),
    selectedBullets: z.array(bulletSelectionSchema).optional(),
    selectedTechTags: z.array(z.string()).optional(),
    selectedThemes: z.array(z.string()).optional(),
    format: z.enum(formatValues).optional(),
    sectionEmphasis: z.enum(emphasisValues).optional(),
    sectionOrder: z.array(z.enum(sectionTypes)).optional(),
    hiddenSections: z.array(z.enum(sectionTypes)).optional(),
    maxBulletsPerRole: z.number().int().min(1).max(8).optional(),
    includeProjects: z.boolean().optional(),
    atsOptimized: z.boolean().optional(),
    summaryInstructions: z.string().max(500).optional(),
  })
  .strict();

const reviseSchema = z
  .object({
    instructions: z.string().min(10).max(2000),
    selectedBullets: z.array(bulletSelectionSchema).optional(),
    selectedTechTags: z.array(z.string()).optional(),
    sectionOrder: z.array(z.enum(sectionTypes)).optional(),
    hiddenSections: z.array(z.enum(sectionTypes)).optional(),
    format: z.enum(formatValues).optional(),
    sectionEmphasis: z.enum(emphasisValues).optional(),
    version: z.number().int().positive(),
  })
  .strict();

const updateSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    status: z.enum(['draft', 'finalized']).optional(),
    version: z.number().int().positive(),
  })
  .strict();

const suggestBulletsSchema = z
  .object({
    jobDescriptionText: z.string().min(50).max(50000).optional(),
    jobDescriptionUrl: z.string().url().optional(),
    jobFitAnalysisId: z.string().optional(),
    maxBulletsPerSection: z.number().int().positive().max(20).optional(),
    impactCategories: z.array(z.string()).optional(),
    excludeBulletIds: z.array(z.string()).optional(),
  })
  .strict();

const listQuerySchema = z.object({
  status: z.enum(['draft', 'finalized']).optional(),
  company: z.string().optional(),
  search: z.string().optional(),
  format: z.enum(formatValues).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

const exportSchema = z
  .object({
    format: z.enum(['docx']),
    template: z.enum(['modern', 'classic', 'minimal', 'ats_optimized']).optional(),
    headerInfo: z.object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      linkedin: z.string().optional(),
      github: z.string().optional(),
      location: z.string().optional(),
      portfolio: z.string().optional(),
    }),
    fontFamily: z.enum(['default', 'serif', 'modern']).optional(),
    fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]).optional(),
    margins: z.enum(['normal', 'narrow', 'wide']).optional(),
    targetPages: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .strict();

export const resumeVariantsRoutes = new Hono<AppEnv>()
  .post('/resume-variants/generate', async (c) => {
    const parsed = generateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await generateResumeVariant(parsed.data, c.get('userId') ?? undefined);
    return c.json(result, 201);
  })
  .post('/resume-variants/suggest-bullets', async (c) => {
    const parsed = suggestBulletsSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await suggestBullets(parsed.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/resume-variants', async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await listResumeVariants(parsed.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/resume-variants/:id', async (c) => {
    const result = await getResumeVariant(c.req.param('id'), c.get('userId') ?? undefined);
    return c.json(result);
  })
  .patch('/resume-variants/:id', async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const variant = await updateResumeVariant(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json({ variant });
  })
  .delete('/resume-variants/:id', async (c) => {
    await deleteResumeVariant(c.req.param('id'), c.get('userId') ?? undefined);
    return c.body(null, 204);
  })
  .post('/resume-variants/:id/revise', async (c) => {
    const parsed = reviseSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await reviseResumeVariant(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  })
  .post('/resume-variants/:id/export', async (c) => {
    const parsed = exportSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }

    const acceptJson = (c.req.header('accept') ?? '').includes('application/json');
    const result = await exportResumeVariant(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );

    if (acceptJson) {
      return c.json({
        exportId: ulid(),
        format: parsed.data.format,
        filename: result.filename,
        fileSize: result.buffer.length,
        base64Content: result.buffer.toString('base64'),
        pageCount: result.pageCount,
        createdAt: new Date().toISOString(),
      });
    }

    return new Response(result.buffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  });
