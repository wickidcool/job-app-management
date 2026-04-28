import type { FastifyInstance } from 'fastify';
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

const formatValues = ['chronological', 'functional', 'hybrid'] as const;
const emphasisValues = ['experience_heavy', 'skills_heavy', 'balanced'] as const;
const sectionTypes = ['summary', 'experience', 'skills', 'projects', 'education', 'certifications'] as const;

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
    format: z.enum(['pdf', 'docx']),
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

export async function resumeVariantsRoutes(fastify: FastifyInstance) {
  // POST /api/resume-variants/generate
  fastify.post('/resume-variants/generate', async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await generateResumeVariant(parsed.data);
    return reply.status(201).send(result);
  });

  // POST /api/resume-variants/suggest-bullets
  fastify.post('/resume-variants/suggest-bullets', async (request, reply) => {
    const parsed = suggestBulletsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await suggestBullets(parsed.data);
    return reply.send(result);
  });

  // GET /api/resume-variants
  fastify.get('/resume-variants', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await listResumeVariants(parsed.data);
    return reply.send(result);
  });

  // GET /api/resume-variants/:id
  fastify.get('/resume-variants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getResumeVariant(id);
    return reply.send(result);
  });

  // PATCH /api/resume-variants/:id
  fastify.patch('/resume-variants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const variant = await updateResumeVariant(id, parsed.data);
    return reply.send({ variant });
  });

  // DELETE /api/resume-variants/:id
  fastify.delete('/resume-variants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteResumeVariant(id);
    return reply.status(204).send();
  });

  // POST /api/resume-variants/:id/revise
  fastify.post('/resume-variants/:id/revise', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = reviseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }
    const result = await reviseResumeVariant(id, parsed.data);
    return reply.send(result);
  });

  // POST /api/resume-variants/:id/export
  fastify.post('/resume-variants/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = exportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parsed.error.message } });
    }

    const acceptJson = (request.headers['accept'] ?? '').includes('application/json');
    const result = await exportResumeVariant(id, parsed.data);

    if (acceptJson) {
      return reply.send({
        exportId: ulid(),
        format: parsed.data.format,
        filename: result.filename,
        fileSize: result.buffer.length,
        base64Content: result.buffer.toString('base64'),
        pageCount: result.pageCount,
        createdAt: new Date().toISOString(),
      });
    }

    return reply
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.buffer);
  });
}
