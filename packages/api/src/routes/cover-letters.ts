import { Hono } from 'hono';
import { z } from 'zod';
import {
  generateCoverLetter,
  getCoverLetter,
  listCoverLetters,
  updateCoverLetter,
  deleteCoverLetter,
  reviseCoverLetter,
  generateOutreach,
  exportCoverLetter,
} from '../services/cover-letter.service.js';
import type { AppEnv } from '../types/env.js';

const toneValues = ['professional', 'conversational', 'enthusiastic', 'technical'] as const;
const lengthValues = ['concise', 'standard', 'detailed'] as const;
const emphasisValues = ['technical', 'leadership', 'balanced'] as const;

const generateSchema = z
  .object({
    jobDescriptionText: z.string().min(50).max(50000).optional(),
    jobDescriptionUrl: z.string().url().optional(),
    jobFitAnalysisId: z.string().optional(),
    selectedStarEntryIds: z.array(z.string()).min(1).max(10),
    targetCompany: z.string().min(1).max(200).optional(),
    targetRole: z.string().min(1).max(200).optional(),
    tone: z.enum(toneValues).optional(),
    lengthVariant: z.enum(lengthValues).optional(),
    emphasis: z.enum(emphasisValues).optional(),
    emphasizeThemes: z.array(z.string().min(1).max(100)).max(5).optional(),
    customInstructions: z.string().max(500).optional(),
  })
  .strict();

const reviseSchema = z
  .object({
    instructions: z.string().min(10).max(2000),
    selectedStarEntryIds: z.array(z.string()).optional(),
    tone: z.enum(toneValues).optional(),
    lengthVariant: z.enum(lengthValues).optional(),
    emphasis: z.enum(emphasisValues).optional(),
    version: z.number().int().positive(),
  })
  .strict();

const updateSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    content: z.string().min(1).optional(),
    status: z.enum(['draft', 'finalized']).optional(),
    version: z.number().int().positive(),
  })
  .strict();

const outreachSchema = z
  .object({
    platform: z.enum(['linkedin', 'email']),
    targetName: z.string().max(200).optional(),
    targetTitle: z.string().max(200).optional(),
    targetCompany: z.string().min(1).max(200),
    targetRole: z.string().max(200).optional(),
    coverLetterId: z.string().optional(),
    jobFitAnalysisId: z.string().optional(),
    selectedStarEntryIds: z.array(z.string()).max(3).optional(),
    keyPoints: z.array(z.string().max(200)).max(3).optional(),
    callToAction: z
      .enum(['coffee_chat', 'referral', 'application_follow_up', 'informational'])
      .optional(),
    maxLength: z.number().int().positive().optional(),
  })
  .strict();

const exportSchema = z
  .object({
    format: z.literal('docx'),
    includeHeader: z.boolean().optional(),
    headerInfo: z
      .object({
        name: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        linkedin: z.string().optional(),
      })
      .optional(),
    fontSize: z.union([z.literal(11), z.literal(12)]).optional(),
  })
  .strict();

const listQuerySchema = z.object({
  status: z.enum(['draft', 'finalized']).optional(),
  company: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export const coverLettersRoutes = new Hono<AppEnv>()
  .post('/cover-letters/generate', async (c) => {
    const parsed = generateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await generateCoverLetter(parsed.data, c.get('userId') ?? undefined);
    return c.json(result, 201);
  })
  .post('/cover-letters/outreach', async (c) => {
    const parsed = outreachSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await generateOutreach(parsed.data, c.get('userId') ?? undefined);
    return c.json(result, 201);
  })
  .get('/cover-letters', async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await listCoverLetters(parsed.data, c.get('userId') ?? undefined);
    return c.json(result);
  })
  .get('/cover-letters/:id', async (c) => {
    const result = await getCoverLetter(c.req.param('id'), c.get('userId') ?? undefined);
    return c.json(result);
  })
  .patch('/cover-letters/:id', async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const coverLetter = await updateCoverLetter(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json({ coverLetter });
  })
  .delete('/cover-letters/:id', async (c) => {
    await deleteCoverLetter(c.req.param('id'), c.get('userId') ?? undefined);
    return c.body(null, 204);
  })
  .post('/cover-letters/:id/revise', async (c) => {
    const parsed = reviseSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await reviseCoverLetter(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  })
  .post('/cover-letters/:id/export', async (c) => {
    const parsed = exportSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await exportCoverLetter(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json({
      exportId: c.req.param('id'),
      format: parsed.data.format,
      filename: result.filename,
      fileSize: result.buffer.length,
      base64Content: result.buffer.toString('base64'),
      createdAt: new Date().toISOString(),
    });
  });
