import type { FastifyInstance } from 'fastify';
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

const toneValues = ['professional', 'conversational', 'enthusiastic', 'technical'] as const;
const lengthValues = ['concise', 'standard', 'detailed'] as const;

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
    emphasizeThemes: z.array(z.string()).optional(),
    customInstructions: z.string().max(500).optional(),
  })
  .strict();

const reviseSchema = z
  .object({
    instructions: z.string().min(10).max(2000),
    selectedStarEntryIds: z.array(z.string()).optional(),
    tone: z.enum(toneValues).optional(),
    lengthVariant: z.enum(lengthValues).optional(),
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

export async function coverLettersRoutes(fastify: FastifyInstance) {
  // POST /api/cover-letters/generate
  fastify.post('/cover-letters/generate', async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await generateCoverLetter(parsed.data);
    return reply.status(201).send(result);
  });

  // POST /api/cover-letters/outreach
  fastify.post('/cover-letters/outreach', async (request, reply) => {
    const parsed = outreachSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await generateOutreach(parsed.data);
    return reply.status(201).send(result);
  });

  // GET /api/cover-letters
  fastify.get('/cover-letters', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await listCoverLetters(parsed.data);
    return reply.send(result);
  });

  // GET /api/cover-letters/:id
  fastify.get('/cover-letters/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getCoverLetter(id);
    return reply.send(result);
  });

  // PATCH /api/cover-letters/:id
  fastify.patch('/cover-letters/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const coverLetter = await updateCoverLetter(id, parsed.data);
    return reply.send({ coverLetter });
  });

  // DELETE /api/cover-letters/:id
  fastify.delete('/cover-letters/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteCoverLetter(id);
    return reply.status(204).send();
  });

  // POST /api/cover-letters/:id/revise
  fastify.post('/cover-letters/:id/revise', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = reviseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await reviseCoverLetter(id, parsed.data);
    return reply.send(result);
  });

  // POST /api/cover-letters/:id/export
  fastify.post('/cover-letters/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = exportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }

    const acceptJson = (request.headers['accept'] ?? '').includes('application/json');
    const result = await exportCoverLetter(id, parsed.data);

    if (acceptJson) {
      return reply.send({
        exportId: id,
        format: parsed.data.format,
        filename: result.filename,
        fileSize: result.buffer.length,
        base64Content: result.buffer.toString('base64'),
        createdAt: new Date().toISOString(),
      });
    }

    return reply
      .status(200)
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.buffer);
  });
}
