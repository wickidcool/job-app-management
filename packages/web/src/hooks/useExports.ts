import { useQuery } from '@tanstack/react-query';
import { resumeService } from '../services/api';

export const exportKeys = {
  all: ['exports'] as const,
  list: () => [...exportKeys.all, 'list'] as const,
  byResume: (resumeId: string) => [...exportKeys.all, 'list', resumeId] as const,
};

/**
 * Every export across every resume. Backs the nav export-count badge.
 */
export function useExports() {
  return useQuery({
    queryKey: exportKeys.list(),
    queryFn: () => resumeService.listAllExports(),
    staleTime: 30000,
  });
}

/**
 * Exports for a single resume, or all of them when `resumeId` is undefined —
 * the two shapes the `/resumes/exports` and `/resumes/:resumeId/exports` routes
 * need. The query key varies with `resumeId` so the two never share a cache
 * entry.
 */
export function useResumeExports(resumeId?: string) {
  return useQuery({
    queryKey: resumeId ? exportKeys.byResume(resumeId) : exportKeys.list(),
    queryFn: () =>
      resumeId ? resumeService.listExports(resumeId) : resumeService.listAllExports(),
    staleTime: 30000,
  });
}
