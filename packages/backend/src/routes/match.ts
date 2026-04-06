import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { matchJobDescription } from '../matching/matcher.js';
import type { IndexStore } from '../storage/indexStore.js';
import type { ProjectStore } from '../storage/projectStore.js';

interface MatchPluginOptions extends FastifyPluginOptions {
  indexStore: IndexStore;
  projectStore: ProjectStore;
}

export async function matchRoutes(app: FastifyInstance, opts: MatchPluginOptions): Promise<void> {
  const { indexStore, projectStore } = opts;

  app.post('/match', async (request, reply) => {
    const { jobDescription } = request.body as { jobDescription: string };
    if (!jobDescription) return reply.status(400).send({ error: 'Bad Request', message: 'jobDescription is required' });
    const indexContent = indexStore.getIndex();
    const projects = projectStore.listProjects();
    const projectMtimes = new Map(projects.map(p => [p.slug, p.mtime]));
    const result = matchJobDescription(jobDescription, indexContent, projectMtimes);
    return reply.send(result);
  });
}
