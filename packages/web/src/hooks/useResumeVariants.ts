import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resumeVariantService } from '../services/api';
import type {
  GenerateResumeVariantRequest,
  ReviseResumeVariantRequest,
  UpdateResumeVariantRequest,
  SuggestBulletsRequest,
  ExportResumeVariantRequest,
  ResumeFormat,
} from '../services/api/types';

/**
 * Query keys for resume variants
 */
export const resumeVariantKeys = {
  all: ['resumeVariants'] as const,
  lists: () => [...resumeVariantKeys.all, 'list'] as const,
  list: (filters?: unknown) => [...resumeVariantKeys.lists(), filters] as const,
  details: () => [...resumeVariantKeys.all, 'detail'] as const,
  detail: (id: string) => [...resumeVariantKeys.details(), id] as const,
  suggestions: () => [...resumeVariantKeys.all, 'suggestions'] as const,
  suggestion: (params?: unknown) => [...resumeVariantKeys.suggestions(), params] as const,
};

/**
 * Fetch all resume variants
 */
export function useResumeVariants(params?: {
  status?: 'draft' | 'finalized';
  company?: string;
  search?: string;
  format?: ResumeFormat;
  limit?: number;
  cursor?: string;
}) {
  return useQuery({
    queryKey: resumeVariantKeys.list(params),
    queryFn: () => resumeVariantService.list(params),
  });
}

/**
 * Fetch single resume variant by ID
 */
export function useResumeVariant(id: string | undefined) {
  return useQuery({
    queryKey: resumeVariantKeys.detail(id!),
    queryFn: () => resumeVariantService.getById(id!),
    enabled: !!id,
  });
}

/**
 * Generate new resume variant
 */
export function useGenerateResumeVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: GenerateResumeVariantRequest) => resumeVariantService.generate(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resumeVariantKeys.lists() });
    },
  });
}

/**
 * Update existing resume variant
 */
export function useUpdateResumeVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: UpdateResumeVariantRequest }) =>
      resumeVariantService.update(id, request),
    onSuccess: (updatedVariant) => {
      queryClient.invalidateQueries({ queryKey: resumeVariantKeys.lists() });
      queryClient.invalidateQueries({ queryKey: resumeVariantKeys.detail(updatedVariant.id) });
    },
  });
}

/**
 * Delete resume variant
 */
export function useDeleteResumeVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => resumeVariantService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resumeVariantKeys.lists() });
    },
  });
}

/**
 * Revise existing resume variant
 */
export function useReviseResumeVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ReviseResumeVariantRequest }) =>
      resumeVariantService.revise(id, request),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: resumeVariantKeys.lists() });
      queryClient.invalidateQueries({ queryKey: resumeVariantKeys.detail(response.variant.id) });
    },
  });
}

/**
 * Suggest bullets for a job context
 */
export function useSuggestBullets(request: SuggestBulletsRequest) {
  return useQuery({
    queryKey: resumeVariantKeys.suggestion(request),
    queryFn: () => resumeVariantService.suggestBullets(request),
    enabled: !!(request.jobDescriptionText || request.jobDescriptionUrl || request.jobFitAnalysisId),
  });
}

/**
 * Export resume variant to PDF/DOCX
 */
export function useExportResumeVariant() {
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ExportResumeVariantRequest }) =>
      resumeVariantService.export(id, request),
  });
}
