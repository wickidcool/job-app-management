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
 * This is the only list hook. Read `collection.applications` for the rows, and
 * `collection.truncated` before rendering a count, a total, or a "nothing to see
 * here" conclusion — it is the only signal that the rows are a prefix rather than
 * the whole set.
 *
 * There used to be a second hook, `useApplications`, which ran the identical query
 * and `select`ed the rows out of the result. Its docstring carried the sentence
 * above as a *rule* directing callers here — and both of its callers broke it
 * (`CommandPalette` rendered "No results found"; `App` rendered the nav count
 * badges). A rule nothing enforces and every caller violates is worse than no rule,
 * because the next reader takes it for a guarantee. WIC-2181 migrated both callers,
 * which left that hook with none, so it is gone: the rule is now a property of the
 * only API there is rather than a request. Projecting the rows out is one line at
 * the call site (`collection?.applications ?? []`), and that line is where the
 * caller has to look at `truncated` anyway.
 */
export function useApplicationCollection(filters?: ApplicationFilters) {
  return useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: () => applicationService.getAllPaged(filters),
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
