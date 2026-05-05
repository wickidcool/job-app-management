import { Hono } from 'hono';
import { getDashboardStats } from '../services/dashboard.service.js';
import type { AppEnv } from '../types/env.js';

export const dashboardRoutes = new Hono<AppEnv>().get('/dashboard', async (c) => {
  const result = await getDashboardStats(c.get('userId') ?? undefined);
  return c.json(result);
});
