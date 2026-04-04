import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { parseResume } from '../resume/parser.js';
import type { ProjectStore } from '../storage/projectStore.js';
import type { IndexStore } from '../storage/indexStore.js';

interface ResumePluginOptions extends FastifyPluginOptions {
  projectStore: ProjectStore;
  indexStore: IndexStore;
}

export async function resumeRoutes(app: FastifyInstance, _opts: ResumePluginOptions): Promise<void> {
  app.post('/resume/parse', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const result = await parseResume(buffer, data.mimetype);
    return reply.send(result);
  });
}
