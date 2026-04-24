import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogService } from '../services/api';
import type { ApplyDiffRequest } from '../types/catalog';

/**
 * TanStack Query hooks for UC-2 Catalog operations
 */

const QUERY_KEYS = {
  diffs: ['catalog', 'diffs'] as const,
  diff: (id: string) => ['catalog', 'diffs', id] as const,
  companies: (params?: Record<string, unknown>) =>
    ['catalog', 'companies', params] as const,
  techStackTags: (params?: Record<string, unknown>) =>
    ['catalog', 'tags', 'tech-stack', params] as const,
  jobFitTags: (params?: Record<string, unknown>) =>
    ['catalog', 'tags', 'job-fit', params] as const,
  quantifiedBullets: (params?: Record<string, unknown>) =>
    ['catalog', 'quantified-bullets', params] as const,
};

/**
 * List all pending catalog diffs
 */
export function useCatalogDiffs() {
  return useQuery({
    queryKey: QUERY_KEYS.diffs,
    queryFn: () => catalogService.listDiffs(),
  });
}

/**
 * Get a specific catalog diff by ID
 */
export function useCatalogDiff(diffId: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.diff(diffId || ''),
    queryFn: () => catalogService.getDiff(diffId!),
    enabled: !!diffId,
  });
}

/**
 * Generate a new catalog diff
 */
export function useGenerateDiff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { sourceType: 'resume' | 'application'; sourceId: string }) =>
      catalogService.generateDiff(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.diffs });
    },
  });
}

/**
 * Apply selected changes from a diff
 */
export function useApplyDiff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ diffId, request }: { diffId: string; request: ApplyDiffRequest }) =>
      catalogService.applyDiff(diffId, request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.diffs });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.diff(variables.diffId) });
      queryClient.invalidateQueries({ queryKey: ['catalog', 'companies'] });
      queryClient.invalidateQueries({ queryKey: ['catalog', 'tags'] });
      queryClient.invalidateQueries({ queryKey: ['catalog', 'quantified-bullets'] });
    },
  });
}

/**
 * Discard a pending diff
 */
export function useDiscardDiff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (diffId: string) => catalogService.discardDiff(diffId),
    onSuccess: (_, diffId) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.diffs });
      queryClient.removeQueries({ queryKey: QUERY_KEYS.diff(diffId) });
    },
  });
}

/**
 * Get companies from catalog
 */
export function useCompanyCatalog(params?: { search?: string; sort?: string }) {
  return useQuery({
    queryKey: QUERY_KEYS.companies(params),
    queryFn: () => catalogService.getCompanies(params),
  });
}

/**
 * Get tech stack tags from catalog
 */
export function useTechStackTags(params?: {
  category?: string;
  search?: string;
  sort?: string;
}) {
  return useQuery({
    queryKey: QUERY_KEYS.techStackTags(params),
    queryFn: () => catalogService.getTechStackTags(params),
  });
}

/**
 * Get job fit tags from catalog
 */
export function useJobFitTags(params?: {
  category?: string;
  search?: string;
  sort?: string;
}) {
  return useQuery({
    queryKey: QUERY_KEYS.jobFitTags(params),
    queryFn: () => catalogService.getJobFitTags(params),
  });
}

/**
 * Get quantified bullets from catalog
 */
export function useQuantifiedBullets(params?: {
  impact?: string;
  search?: string;
  sort?: string;
}) {
  return useQuery({
    queryKey: QUERY_KEYS.quantifiedBullets(params),
    queryFn: () => catalogService.getQuantifiedBullets(params),
  });
}
