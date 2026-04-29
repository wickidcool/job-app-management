import type { FastifyInstance } from 'fastify';
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

const interviewTypeValues = ['behavioral', 'technical', 'mixed', 'case_study'] as const;
const prepTimeValues = ['30min', '1hr', '2hr', 'full_day'] as const;
const confidenceLevelValues = ['not_practiced', 'needs_work', 'comfortable', 'confident'] as const;
const mitigationStrategyValues = ['acknowledge_pivot', 'growth_mindset', 'adjacent_experience'] as const;

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

const getQuerySchema = z.object({
  includeStories: z.coerce.boolean().optional(),
  includeQuestions: z.coerce.boolean().optional(),
  includeGaps: z.coerce.boolean().optional(),
});

export async function interviewPrepsRoutes(fastify: FastifyInstance) {
  // POST /api/interview-preps — Generate interview prep for an application
  fastify.post('/interview-preps', async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await generateInterviewPrep(parsed.data);
    return reply.status(201).send(result);
  });

  // GET /api/interview-preps/:id — Get interview prep by ID
  fastify.get('/interview-preps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getInterviewPrep(id);
    return reply.send(result);
  });

  // PATCH /api/interview-preps/:id — Update prep selections, notes, practice
  fastify.patch('/interview-preps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await updateInterviewPrep(id, parsed.data);
    return reply.send(result);
  });

  // GET /api/interview-preps/:id/export — Export quick reference card
  fastify.get('/interview-preps/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }

    const sections = parsed.data.sections ? parsed.data.sections.split(',').map((s) => s.trim()) : undefined;
    const result = await exportInterviewPrep(id, parsed.data.format, sections);

    const acceptJson = (request.headers['accept'] ?? '').includes('application/json');
    if (acceptJson) {
      return reply.send({
        exportId: ulid(),
        format: parsed.data.format,
        filename: result.filename,
        fileSize: result.buffer.length,
        base64Content: result.buffer.toString('base64'),
        createdAt: new Date().toISOString(),
      });
    }

    const disposition = parsed.data.format === 'print' ? 'inline' : `attachment; filename="${result.filename}"`;
    return reply
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', disposition)
      .send(result.buffer);
  });

  // POST /api/interview-preps/:id/practice — Log a practice session
  fastify.post('/interview-preps/:id/practice', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = practiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await logPracticeSession(id, parsed.data);
    return reply.send(result);
  });

  // DELETE /api/interview-preps/:id — Delete interview prep
  fastify.delete('/interview-preps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteInterviewPrep(id);
    return reply.status(204).send();
  });

  // GET /api/applications/:applicationId/interview-prep — Get prep for application
  fastify.get('/applications/:applicationId/interview-prep', async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const result = await getInterviewPrepByApplication(applicationId);
    return reply.send(result);
  });
}
