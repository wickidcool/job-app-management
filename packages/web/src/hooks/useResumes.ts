import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useDeleteResume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => resumeService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: resumeKeys.all,
      });
    },
  });
}
