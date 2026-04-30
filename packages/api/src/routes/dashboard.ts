import type { FastifyInstance } from 'fastify';
import { getDashboardStats } from '../services/dashboard.service.js';

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/dashboard', async (request, reply) => {
    const result = await getDashboardStats(request.userId ?? undefined);
    return reply.send(result);
  });
}
