import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectService, type CreateProjectInput } from '../services/api';

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: () => [...projectKeys.lists()] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (slug: string) => [...projectKeys.details(), slug] as const,
  files: (slug: string) => [...projectKeys.detail(slug), 'files'] as const,
  file: (slug: string, fileName: string) => [...projectKeys.files(slug), fileName] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () => projectService.listProjects(),
    staleTime: 30000,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => projectService.createProject(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.list(),
      });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (slug: string) => projectService.deleteProject(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.list(),
      });
    },
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

export function useCreateProjectFile() {
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
    }) => projectService.createProjectFile(projectId, fileName, content),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.files(variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.all,
      });
    },
  });
}

export function useDeleteProjectFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, fileName }: { projectId: string; fileName: string }) =>
      projectService.deleteProjectFile(projectId, fileName),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.files(variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.all,
      });
    },
  });
}
