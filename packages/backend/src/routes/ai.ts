import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { NotFoundError, type ProjectStore } from '../storage/projectStore.js';
import type { IndexStore } from '../storage/indexStore.js';
import type { AIProvider } from '../ai/interface.js';

interface AIPluginOptions extends FastifyPluginOptions {
  projectStore: ProjectStore;
  indexStore: IndexStore;
  aiProvider: AIProvider;
}

export async function aiRoutes(app: FastifyInstance, opts: AIPluginOptions): Promise<void> {
  const { projectStore, indexStore, aiProvider } = opts;

  app.post('/ai/update/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { instruction } = request.body as { instruction: string };
    if (!instruction) return reply.status(400).send({ error: 'Bad Request', message: 'instruction is required' });
    try {
      const content = projectStore.getProject(slug);
      const updated = await aiProvider.updateProjectFile(content, instruction);
      projectStore.updateProject(slug, updated);
      indexStore.regenerateIndex(projectStore);
      return reply.send({ slug, content: updated });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: (err as Error).message });
      throw err;
    }
  });

  app.post('/ai/cover-letter', async (request, reply) => {
    const { jobDescription, additionalContext } = request.body as { jobDescription: string; additionalContext?: string };
    if (!jobDescription) return reply.status(400).send({ error: 'Bad Request', message: 'jobDescription is required' });
    const indexContent = indexStore.getIndex();
    const coverLetter = await aiProvider.generateCoverLetter(indexContent, jobDescription, additionalContext);
    return reply.send({ coverLetter });
  });
}
