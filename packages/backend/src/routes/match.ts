import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { matchJobDescription } from '../matching/matcher.js';
import type { IndexStore } from '../storage/indexStore.js';

interface MatchPluginOptions extends FastifyPluginOptions {
  indexStore: IndexStore;
}

export async function matchRoutes(app: FastifyInstance, opts: MatchPluginOptions): Promise<void> {
  const { indexStore } = opts;

  app.post('/match', async (request, reply) => {
    const { jobDescription } = request.body as { jobDescription: string };
    if (!jobDescription) return reply.status(400).send({ error: 'Bad Request', message: 'jobDescription is required' });
    const indexContent = indexStore.getIndex();
    const result = matchJobDescription(jobDescription, indexContent);
    return reply.send(result);
  });
}
