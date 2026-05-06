import { Hono } from 'hono';
import { z } from 'zod';
import { ulid } from 'ulid';
import {
  generateInterviewPrep,
  getInterviewPrep,
  getInterviewPrepByApplication,
  updateInterviewPrep,
  exportInterviewPrep,
  logPracticeSession,
  deleteInterviewPrep,
} from '../services/interviewPrep.service.js';
import type { AppEnv } from '../types/env.js';

const interviewTypeValues = ['behavioral', 'technical', 'mixed', 'case_study'] as const;
const prepTimeValues = ['30min', '1hr', '2hr', 'full_day'] as const;
const confidenceLevelValues = ['not_practiced', 'needs_work', 'comfortable', 'confident'] as const;
const mitigationStrategyValues = [
  'acknowledge_pivot',
  'growth_mindset',
  'adjacent_experience',
] as const;

const generateSchema = z
  .object({
    applicationId: z.string().min(1),
    jobFitAnalysisId: z.string().optional(),
    interviewType: z.enum(interviewTypeValues).optional(),
    timeAvailable: z.enum(prepTimeValues).optional(),
    focusAreas: z.array(z.string()).optional(),
  })
  .strict();

const storyUpdateSchema = z.object({
  storyId: z.string().min(1),
  isFavorite: z.boolean().optional(),
  personalNotes: z.string().optional(),
  confidenceLevel: z.enum(confidenceLevelValues).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

const questionUpdateSchema = z.object({
  questionId: z.string().min(1),
  linkedStoryId: z.string().nullable().optional(),
  personalNotes: z.string().optional(),
  practiceStatus: z.enum(confidenceLevelValues).optional(),
});

const gapUpdateSchema = z.object({
  gapId: z.string().min(1),
  selectedStrategy: z.enum(mitigationStrategyValues).optional(),
  isAddressed: z.boolean().optional(),
});

const sectionConfigSchema = z.object({
  id: z.enum(['stories', 'questions', 'gaps', 'company']),
  enabled: z.boolean(),
  order: z.number().int().min(0),
  selectedItems: z.array(z.string()),
});

const companyFactSchema = z.object({
  id: z.string().min(1),
  fact: z.string().min(1),
  source: z.string().min(1),
  useFor: z.enum(['mention', 'ask_about']),
});

const quickReferenceUpdateSchema = z.object({
  sections: z.array(sectionConfigSchema).optional(),
  topStoryIds: z.array(z.string()).optional(),
  keyQuestionIds: z.array(z.string()).optional(),
  gapPointIds: z.array(z.string()).optional(),
  companyFacts: z.array(companyFactSchema).optional(),
});

const updateSchema = z
  .object({
    storyUpdates: z.array(storyUpdateSchema).optional(),
    questionUpdates: z.array(questionUpdateSchema).optional(),
    gapUpdates: z.array(gapUpdateSchema).optional(),
    quickReference: quickReferenceUpdateSchema.optional(),
    focusAreas: z.array(z.string()).optional(),
    interviewType: z.enum(interviewTypeValues).optional(),
    timeAvailable: z.enum(prepTimeValues).optional(),
    version: z.number().int().positive(),
  })
  .strict();

const questionResultSchema = z.object({
  questionId: z.string().min(1),
  confidenceRating: z.enum(confidenceLevelValues),
  usedStoryId: z.string().optional(),
  notes: z.string().optional(),
});

const storyResultSchema = z.object({
  storyId: z.string().min(1),
  confidenceRating: z.enum(confidenceLevelValues),
  timeUsed: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

const gapResultSchema = z.object({
  gapId: z.string().min(1),
  strategyUsed: z.enum(mitigationStrategyValues),
  confidenceRating: z.enum(confidenceLevelValues),
  notes: z.string().optional(),
});

const practiceSchema = z
  .object({
    type: z.enum(['single_question', 'full_interview', 'timed_responses']),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    focusAreas: z.array(z.string()).optional(),
    questionResults: z.array(questionResultSchema).optional(),
    storyResults: z.array(storyResultSchema).optional(),
    gapResults: z.array(gapResultSchema).optional(),
    version: z.number().int().positive(),
  })
  .strict();

const exportQuerySchema = z.object({
  format: z.enum(['pdf', 'markdown', 'print']),
  sections: z.string().optional(),
});

export const interviewPrepsRoutes = new Hono<AppEnv>()
  .post('/interview-preps', async (c) => {
    const parsed = generateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await generateInterviewPrep(parsed.data, c.get('userId') ?? undefined);
    return c.json(result, 201);
  })
  .get('/interview-preps/:id', async (c) => {
    const result = await getInterviewPrep(c.req.param('id'), c.get('userId') ?? undefined);
    return c.json(result);
  })
  .patch('/interview-preps/:id', async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await updateInterviewPrep(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  })
  .get('/interview-preps/:id/export', async (c) => {
    const parsed = exportQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }

    const sections = parsed.data.sections
      ? parsed.data.sections.split(',').map((s) => s.trim())
      : undefined;
    const result = await exportInterviewPrep(
      c.req.param('id'),
      parsed.data.format,
      sections,
      c.get('userId') ?? undefined
    );

    const acceptJson = (c.req.header('accept') ?? '').includes('application/json');
    if (acceptJson) {
      return c.json({
        exportId: ulid(),
        format: parsed.data.format,
        filename: result.filename,
        fileSize: result.buffer.length,
        base64Content: result.buffer.toString('base64'),
        createdAt: new Date().toISOString(),
      });
    }

    const disposition =
      parsed.data.format === 'print' ? 'inline' : `attachment; filename="${result.filename}"`;
    return new Response(result.buffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': disposition,
      },
    });
  })
  .post('/interview-preps/:id/practice', async (c) => {
    const parsed = practiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const result = await logPracticeSession(
      c.req.param('id'),
      parsed.data,
      c.get('userId') ?? undefined
    );
    return c.json(result);
  })
  .delete('/interview-preps/:id', async (c) => {
    await deleteInterviewPrep(c.req.param('id'), c.get('userId') ?? undefined);
    return c.body(null, 204);
  })
  .get('/applications/:applicationId/interview-prep', async (c) => {
    const result = await getInterviewPrepByApplication(
      c.req.param('applicationId'),
      c.get('userId') ?? undefined
    );
    return c.json(result);
  });
