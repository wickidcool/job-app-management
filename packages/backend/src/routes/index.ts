import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ProjectStore } from '../storage/projectStore.js';
import type { IndexStore } from '../storage/indexStore.js';

interface IndexPluginOptions extends FastifyPluginOptions {
  projectStore: ProjectStore;
  indexStore: IndexStore;
}

export async function indexRoutes(app: FastifyInstance, opts: IndexPluginOptions): Promise<void> {
  const { projectStore, indexStore } = opts;

  app.get('/index', async (_request, reply) => {
    const content = indexStore.getIndex();
    return reply.send({ content });
  });

  app.post('/index/regenerate', async (_request, reply) => {
    indexStore.regenerateIndex(projectStore);
    const content = indexStore.getIndex();
    return reply.send({ content });
  });
}
