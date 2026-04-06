import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { NotFoundError, type ProjectStore } from '../storage/projectStore.js';
import type { IndexStore } from '../storage/indexStore.js';

interface ProjectsPluginOptions extends FastifyPluginOptions {
  projectStore: ProjectStore;
  indexStore: IndexStore;
}

export async function projectsRoutes(app: FastifyInstance, opts: ProjectsPluginOptions): Promise<void> {
  const { projectStore, indexStore } = opts;

  // POST /projects/upload must be registered BEFORE /projects/:slug
  app.post('/projects/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const content = Buffer.concat(chunks).toString('utf8');
    const name = data.filename.replace(/\.md$/, '');
    const slug = projectStore.createProject(name, content);
    indexStore.regenerateIndex(projectStore);
    return reply.status(201).send({ slug, name });
  });

  app.get('/projects', async (_request, reply) => {
    const projects = projectStore.listProjects();
    return reply.send(projects);
  });

  app.post('/projects', async (request, reply) => {
    const { name, content } = request.body as { name: string; content: string };
    if (!name || typeof content !== 'string') {
      return reply.status(400).send({ error: 'Bad Request', message: 'name and content are required' });
    }
    const slug = projectStore.createProject(name, content);
    indexStore.regenerateIndex(projectStore);
    return reply.status(201).send({ slug, name });
  });

  app.get('/projects/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    try {
      const content = projectStore.getProject(slug);
      return reply.send({ slug, content });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: err.message });
      throw err;
    }
  });

  app.put('/projects/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { content } = request.body as { content: string };
    if (typeof content !== 'string') {
      return reply.status(400).send({ error: 'Bad Request', message: 'content is required' });
    }
    try {
      projectStore.updateProject(slug, content);
      indexStore.regenerateIndex(projectStore);
      return reply.send({ slug });
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: (err as Error).message });
      throw err;
    }
  });

  app.delete('/projects/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    try {
      projectStore.deleteProject(slug);
      indexStore.regenerateIndex(projectStore);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Not Found', message: (err as Error).message });
      throw err;
    }
  });
}
