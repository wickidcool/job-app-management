import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectService } from '../services/api';

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: () => [...projectKeys.lists()] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (projectId: string) => [...projectKeys.details(), projectId] as const,
  files: (projectId: string) => [...projectKeys.detail(projectId), 'files'] as const,
  file: (projectId: string, fileName: string) =>
    [...projectKeys.files(projectId), fileName] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () => projectService.listProjects(),
    staleTime: 30000,
  });
}

export function useProjectFiles(projectId: string) {
  return useQuery({
    queryKey: projectKeys.files(projectId),
    queryFn: () => projectService.listProjectFiles(projectId),
    staleTime: 30000,
    enabled: !!projectId,
  });
}

export function useProjectFile(projectId: string, fileName: string) {
  return useQuery({
    queryKey: projectKeys.file(projectId, fileName),
    queryFn: () => projectService.getProjectFile(projectId, fileName),
    staleTime: 30000,
    enabled: !!projectId && !!fileName,
  });
}

export function useUpdateProjectFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      fileName,
      content,
    }: {
      projectId: string;
      fileName: string;
      content: string;
    }) => projectService.updateProjectFile(projectId, fileName, content),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.file(variables.projectId, variables.fileName),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.files(variables.projectId),
      });
    },
  });
}

export function useGenerateIndex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => projectService.generateIndex(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.all,
      });
    },
  });
}
