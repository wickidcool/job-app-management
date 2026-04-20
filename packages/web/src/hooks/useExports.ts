import { useQuery } from '@tanstack/react-query';

export const exportKeys = {
  all: ['exports'] as const,
  list: () => [...exportKeys.all, 'list'] as const,
};

// Placeholder service until backend is ready
const mockExportService = {
  getAll: async () => {
    // TODO: Replace with actual API call when backend is ready
    return [];
  },
};

export function useExports() {
  return useQuery({
    queryKey: exportKeys.list(),
    queryFn: () => mockExportService.getAll(),
    staleTime: 30000,
  });
}
