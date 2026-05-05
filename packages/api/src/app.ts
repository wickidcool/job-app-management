import Fastify from 'fastify';
import cors from '@fastify/cors';
import { applicationsRoutes } from './routes/applications.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { coverLettersRoutes } from './routes/cover-letters.js';
import { resumesRoutes } from './routes/resumes.js';
import { projectsRoutes } from './routes/projects.js';
import { dialogueRoutes } from './routes/dialogue.routes.js';
import { catalogRoutes } from './routes/catalog.routes.js';
import { reportsRoutes } from './routes/reports.js';
import { resumeVariantsRoutes } from './routes/resume-variants.js';
import { interviewPrepsRoutes } from './routes/interview-preps.js';
import { authRoutes } from './routes/auth.js';
import { AppError } from './types/index.js';
import { authPlugin } from './plugins/auth.js';

export function buildApp(opts?: { logger?: boolean }) {
  const fastify = Fastify({ logger: opts?.logger ?? true });

  // CORS — allow frontend dev server
  fastify.register(cors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }));

  // API routes under /api prefix
  fastify.register(
    async (api) => {
      api.register(authPlugin);
      api.register(authRoutes);
      api.register(applicationsRoutes);
      api.register(dashboardRoutes);
      api.register(coverLettersRoutes);
      api.register(resumesRoutes);
      api.register(projectsRoutes);
      api.register(dialogueRoutes);
      api.register(catalogRoutes);
      api.register(reportsRoutes);
      api.register(resumeVariantsRoutes);
      api.register(interviewPrepsRoutes);
    },
    { prefix: '/api' }
  );

  // Global error handler
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    // Fastify validation errors
    if (error.statusCode === 400) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: error.message },
      });
    }

    fastify.log.error(error);
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  return fastify;
}
