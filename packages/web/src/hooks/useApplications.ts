import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { applicationService } from '../services/api';
import type { ApplicationCollection } from '../services/api/applicationService';
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

type ApplicationFilters = {
  status?: ApplicationStatus[];
  company?: string;
  search?: string;
};

/**
 * Fetch every application matching `filters`, together with the metadata needed
 * to tell a complete result from a partial one.
 *
 * Use this over {@link useApplications} on any surface that renders a count, a
 * total, or a "nothing to see here" conclusion — `truncated` is the only signal
 * that the list is a prefix rather than the whole set.
 */
export function useApplicationCollection(filters?: ApplicationFilters) {
  return useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: () => applicationService.getAllPaged(filters),
  });
}

/**
 * Fetch all applications.
 *
 * Shares a cache entry with {@link useApplicationCollection} — same query key,
 * same fetch — and just projects out the rows.
 */
export function useApplications(filters?: ApplicationFilters) {
  return useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: () => applicationService.getAllPaged(filters),
    select: (collection) => collection.applications,
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

      // Snapshot previous values.
      //
      // Lists are matched by *prefix*: `lists()` is `['applications', 'list']`,
      // but a list query registers under `list(filters)` = `[...lists(), filters]`,
      // and there is one such entry per filter combination the app has rendered.
      // `getQueryData`/`setQueryData` are exact-match, so reading `lists()` with
      // them always returned `undefined` and the whole optimistic block below was
      // dead code (WIC-1497). `getQueriesData`/`setQueriesData` take a filter and
      // are the prefix-matching pair.
      const previousLists = queryClient.getQueriesData<ApplicationCollection>({
        queryKey: applicationKeys.lists(),
      });
      const previousApplication = queryClient.getQueryData<Application>(applicationKeys.detail(id));

      // Optimistically update every cached list that could be showing this row.
      queryClient.setQueriesData<ApplicationCollection>(
        { queryKey: applicationKeys.lists() },
        (collection) =>
          collection && {
            ...collection,
            applications: collection.applications.map((app) =>
              app.id === id
                ? { ...app, status, updatedAt: new Date(), version: app.version + 1 }
                : app
            ),
          }
      );

      if (previousApplication) {
        queryClient.setQueryData<Application>(applicationKeys.detail(id), {
          ...previousApplication,
          status,
          updatedAt: new Date(),
          version: previousApplication.version + 1,
        });
      }

      return { previousLists, previousApplication };
    },
    onError: (_err, { id }, context) => {
      // Rollback on error. `previousLists` is one `[queryKey, data]` pair per list
      // query that was patched, so every one of them is restored — restoring a
      // single key would leave any other filter showing the failed status.
      context?.previousLists?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
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
