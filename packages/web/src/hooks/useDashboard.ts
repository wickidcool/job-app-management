import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/api';

/**
 * Query keys for dashboard
 */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
};

/**
 * Fetch dashboard statistics and recent activity
 */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: () => dashboardService.getStats(),
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
}
