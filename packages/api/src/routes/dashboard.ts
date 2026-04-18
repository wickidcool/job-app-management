import type { FastifyInstance } from 'fastify';
import { getDashboardStats } from '../services/dashboard.service.js';

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/dashboard', async (_request, reply) => {
    const result = await getDashboardStats();
    return reply.send(result);
  });
}
