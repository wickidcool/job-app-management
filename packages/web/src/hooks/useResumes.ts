import { useQuery } from '@tanstack/react-query';
import { resumeService } from '../services/api';

export const resumeKeys = {
  all: ['resumes'] as const,
  list: () => [...resumeKeys.all, 'list'] as const,
};

export function useResumes() {
  return useQuery({
    queryKey: resumeKeys.list(),
    queryFn: () => resumeService.getAll(),
    staleTime: 30000,
  });
}
