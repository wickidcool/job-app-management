import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { coverLetterService } from '../services/api';
import type {
  GenerateCoverLetterRequest,
  ReviseCoverLetterRequest,
  UpdateCoverLetterRequest,
  GenerateOutreachRequest,
  ExportCoverLetterRequest,
} from '../services/api/types';

/**
 * Query keys for cover letters
 */
export const coverLetterKeys = {
  all: ['coverLetters'] as const,
  lists: () => [...coverLetterKeys.all, 'list'] as const,
  list: (filters?: unknown) => [...coverLetterKeys.lists(), filters] as const,
  details: () => [...coverLetterKeys.all, 'detail'] as const,
  detail: (id: string) => [...coverLetterKeys.details(), id] as const,
};

/**
 * Fetch all cover letters
 */
export function useCoverLetters(params?: {
  status?: 'draft' | 'finalized';
  company?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: coverLetterKeys.list(params),
    queryFn: () => coverLetterService.list(params),
  });
}

/**
 * Fetch single cover letter by ID
 */
export function useCoverLetter(id: string | undefined) {
  return useQuery({
    queryKey: coverLetterKeys.detail(id!),
    queryFn: () => coverLetterService.getById(id!),
    enabled: !!id,
  });
}

/**
 * Generate new cover letter
 */
export function useGenerateCoverLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: GenerateCoverLetterRequest) => coverLetterService.generate(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: coverLetterKeys.lists() });
    },
  });
}

/**
 * Update existing cover letter
 */
export function useUpdateCoverLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: UpdateCoverLetterRequest }) =>
      coverLetterService.update(id, request),
    onSuccess: (updatedCoverLetter) => {
      queryClient.invalidateQueries({ queryKey: coverLetterKeys.lists() });
      queryClient.invalidateQueries({ queryKey: coverLetterKeys.detail(updatedCoverLetter.id) });
    },
  });
}

/**
 * Delete cover letter
 */
export function useDeleteCoverLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => coverLetterService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: coverLetterKeys.lists() });
    },
  });
}

/**
 * Revise existing cover letter
 */
export function useReviseCoverLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ReviseCoverLetterRequest }) =>
      coverLetterService.revise(id, request),
    onSuccess: (updatedCoverLetter) => {
      queryClient.invalidateQueries({ queryKey: coverLetterKeys.lists() });
      queryClient.invalidateQueries({ queryKey: coverLetterKeys.detail(updatedCoverLetter.id) });
    },
  });
}

/**
 * Generate outreach message
 */
export function useGenerateOutreach() {
  return useMutation({
    mutationFn: (request: GenerateOutreachRequest) => coverLetterService.generateOutreach(request),
  });
}

/**
 * Export cover letter to DOCX
 */
export function useExportCoverLetter() {
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ExportCoverLetterRequest }) =>
      coverLetterService.export(id, request),
  });
}
