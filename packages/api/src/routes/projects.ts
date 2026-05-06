import { Hono } from 'hono';
import {
  listProjects,
  listProjectFiles,
  getProjectFile,
  updateProjectFile,
  generateProjectIndex,
  createProject,
  getProjectBySlug,
  deleteProject,
  createProjectFile,
  deleteProjectFile,
} from '../services/project.service.js';
import { AppError } from '../types/index.js';
import type { AppEnv } from '../types/env.js';

export const projectsRoutes = new Hono<AppEnv>()
  .get('/projects', async (c) => {
    const projects = await listProjects(c.get('userId') ?? undefined);
    return c.json({ projects });
  })
  .post('/projects', async (c) => {
    const { name, slug, description } = (await c.req.json()) as {
      name: string;
      slug?: string;
      description?: string;
    };
    if (!name || typeof name !== 'string') {
      throw new AppError('BAD_REQUEST', 'name is required', undefined, 400);
    }
    const project = await createProject({ name, slug, description }, c.get('userId') ?? undefined);
    return c.json(project, 201);
  })
  .get('/projects/:projectId', async (c) => {
    const project = await getProjectBySlug(c.req.param('projectId'), c.get('userId') ?? undefined);
    return c.json(project);
  })
  .delete('/projects/:projectId', async (c) => {
    const project = await getProjectBySlug(c.req.param('projectId'), c.get('userId') ?? undefined);
    await deleteProject(project.id, c.get('userId') ?? undefined);
    return c.body(null, 204);
  })
  .get('/projects/:projectId/files', async (c) => {
    const files = await listProjectFiles(c.req.param('projectId'), c.get('userId') ?? undefined);
    return c.json({ files });
  })
  .get('/projects/:projectId/files/:fileName', async (c) => {
    const content = await getProjectFile(
      c.req.param('projectId'),
      c.req.param('fileName'),
      c.get('userId') ?? undefined
    );
    return c.json({ content });
  })
  .put('/projects/:projectId/files/:fileName', async (c) => {
    const { content } = (await c.req.json()) as { content: string };
    if (typeof content !== 'string') {
      throw new AppError('BAD_REQUEST', 'content must be a string', undefined, 400);
    }
    await updateProjectFile(
      c.req.param('projectId'),
      c.req.param('fileName'),
      content,
      c.get('userId') ?? undefined
    );
    return c.body(null, 204);
  })
  .post('/projects/:projectId/files', async (c) => {
    const { fileName, content } = (await c.req.json()) as {
      fileName: string;
      content: string;
    };
    if (!fileName || typeof fileName !== 'string') {
      throw new AppError('BAD_REQUEST', 'fileName is required', undefined, 400);
    }
    if (typeof content !== 'string') {
      throw new AppError('BAD_REQUEST', 'content must be a string', undefined, 400);
    }
    await createProjectFile(
      c.req.param('projectId'),
      fileName,
      content,
      c.get('userId') ?? undefined
    );
    return c.json({ fileName }, 201);
  })
  .delete('/projects/:projectId/files/:fileName', async (c) => {
    await deleteProjectFile(
      c.req.param('projectId'),
      c.req.param('fileName'),
      c.get('userId') ?? undefined
    );
    return c.body(null, 204);
  })
  .post('/projects/generate-index', async (c) => {
    const result = await generateProjectIndex(c.get('userId') ?? undefined);
    return c.json(result, 201);
  });
