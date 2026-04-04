import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { ProjectStore } from './storage/projectStore.js';
import { IndexStore } from './storage/indexStore.js';
import { createAIProvider } from './ai/factory.js';
import { projectsRoutes } from './routes/projects.js';
import { resumeRoutes } from './routes/resume.js';
import { indexRoutes } from './routes/index.js';
import { aiRoutes } from './routes/ai.js';
import { matchRoutes } from './routes/match.js';
import { config } from './config.js';

interface BuildAppOptions {
  storageDir?: string;
  aiProvider?: string;
  aiApiKey?: string;
  anthropicModel?: string;
  openaiModel?: string;
  port?: number;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const storageDir = options.storageDir ?? config.STORAGE_DIR;
  const projectStore = new ProjectStore(storageDir);
  const indexStore = new IndexStore(storageDir);
  const aiProvider = createAIProvider({
    AI_PROVIDER: options.aiProvider ?? config.AI_PROVIDER,
    AI_API_KEY: options.aiApiKey ?? config.AI_API_KEY,
    ANTHROPIC_MODEL: options.anthropicModel ?? config.ANTHROPIC_MODEL,
    OPENAI_MODEL: options.openaiModel ?? config.OPENAI_MODEL,
  });

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  await app.register(projectsRoutes, { prefix: '/api/v1', projectStore, indexStore });
  await app.register(resumeRoutes, { prefix: '/api/v1', projectStore, indexStore });
  await app.register(indexRoutes, { prefix: '/api/v1', projectStore, indexStore });
  await app.register(aiRoutes, { prefix: '/api/v1', projectStore, indexStore, aiProvider });
  await app.register(matchRoutes, { prefix: '/api/v1', indexStore, projectStore });

  return app;
}

// Only start server when run directly (not in tests)
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = config.PORT;
  const app = await buildApp();
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Server listening on http://localhost:${port}`);
}
