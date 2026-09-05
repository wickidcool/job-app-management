import { Hono } from 'hono';
import { getDashboardStats } from '../services/dashboard.service.js';
import type { AppEnv } from '../types/env.js';
import { requireOwner } from './require-owner.js';

export const dashboardRoutes = new Hono<AppEnv>().get('/dashboard', async (c) => {
  const result = await getDashboardStats(requireOwner(c));
  return c.json(result);
});
