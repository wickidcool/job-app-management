import type { APIClient } from './apiClient';
import type { DashboardResponse } from './types';

/**
 * Dashboard Service using real API
 */
export class DashboardService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  /**
   * Get dashboard statistics and recent activity
   */
  async getStats(): Promise<DashboardResponse> {
    return this.client.get<DashboardResponse>('/dashboard');
  }
}

/**
 * Create dashboard service instance
 */
export function createDashboardService(client: APIClient): DashboardService {
  return new DashboardService(client);
}
