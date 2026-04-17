import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { applicationService } from '../services/api';
import type { Application, ApplicationFormData, ApplicationStatus } from '../types/application';

/**
 * Query keys for applications
 */
export const applicationKeys = {
  all: ['applications'] as const,
  lists: () => [...applicationKeys.all, 'list'] as const,
  list: (filters?: unknown) => [...applicationKeys.lists(), filters] as const,
  details: () => [...applicationKeys.all, 'detail'] as const,
  detail: (id: string) => [...applicationKeys.details(), id] as const,
};

/**
 * Fetch all applications
 */
export function useApplications() {
  return useQuery({
    queryKey: applicationKeys.lists(),
    queryFn: () => applicationService.getAll(),
  });
}

/**
 * Fetch single application by ID
 */
export function useApplication(id: string | undefined) {
  return useQuery({
    queryKey: applicationKeys.detail(id!),
    queryFn: () => applicationService.getById(id!),
    enabled: !!id,
  });
}

/**
 * Create new application
 */
export function useCreateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ApplicationFormData) => applicationService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
    },
  });
}

/**
 * Update existing application
 */
export function useUpdateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
      version,
    }: {
      id: string;
      data: Partial<ApplicationFormData>;
      version: number;
    }) => applicationService.update(id, data, version),
    onSuccess: (updatedApp) => {
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: applicationKeys.detail(updatedApp.id) });
    },
  });
}

/**
 * Update application status with optimistic updates
 */
export function useUpdateApplicationStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      status,
      version,
      note,
    }: {
      id: string;
      status: ApplicationStatus;
      version: number;
      note?: string;
    }) => applicationService.updateStatus(id, status, version, note),
    onMutate: async ({ id, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: applicationKeys.lists() });
      await queryClient.cancelQueries({ queryKey: applicationKeys.detail(id) });

      // Snapshot previous values
      const previousApplications = queryClient.getQueryData<Application[]>(
        applicationKeys.lists()
      );
      const previousApplication = queryClient.getQueryData<Application>(
        applicationKeys.detail(id)
      );

      // Optimistically update to the new value
      if (previousApplications) {
        queryClient.setQueryData<Application[]>(
          applicationKeys.lists(),
          previousApplications.map((app) =>
            app.id === id ? { ...app, status, updatedAt: new Date().toISOString(), version: app.version + 1 } : app
          )
        );
      }

      if (previousApplication) {
        queryClient.setQueryData<Application>(applicationKeys.detail(id), {
          ...previousApplication,
          status,
          updatedAt: new Date().toISOString(),
          version: previousApplication.version + 1,
        });
      }

      return { previousApplications, previousApplication };
    },
    onError: (_err, { id }, context) => {
      // Rollback on error
      if (context?.previousApplications) {
        queryClient.setQueryData(applicationKeys.lists(), context.previousApplications);
      }
      if (context?.previousApplication) {
        queryClient.setQueryData(applicationKeys.detail(id), context.previousApplication);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
    },
  });
}

/**
 * Delete application
 */
export function useDeleteApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => applicationService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
    },
  });
}
