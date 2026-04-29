import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { interviewPrepService } from '../services/api';
import type {
  GenerateInterviewPrepRequest,
  UpdateInterviewPrepRequest,
  LogPracticeSessionRequest,
  ExportFormat,
} from '../types/interviewPrep';

/**
 * Query keys for interview prep
 */
export const interviewPrepKeys = {
  all: ['interview-preps'] as const,
  lists: () => [...interviewPrepKeys.all, 'list'] as const,
  details: () => [...interviewPrepKeys.all, 'detail'] as const,
  detail: (id: string) => [...interviewPrepKeys.details(), id] as const,
  byApplication: (applicationId: string) => [
    ...interviewPrepKeys.all,
    'application',
    applicationId,
  ] as const,
};

/**
 * Fetch interview prep by ID
 */
export function useInterviewPrep(id: string | undefined) {
  return useQuery({
    queryKey: interviewPrepKeys.detail(id!),
    queryFn: () => interviewPrepService.getById(id!),
    enabled: !!id,
  });
}

/**
 * Fetch interview prep by application ID
 */
export function useInterviewPrepByApplication(applicationId: string | undefined) {
  return useQuery({
    queryKey: interviewPrepKeys.byApplication(applicationId!),
    queryFn: () => interviewPrepService.getByApplicationId(applicationId!),
    enabled: !!applicationId,
  });
}

/**
 * Generate new interview prep
 */
export function useGenerateInterviewPrep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GenerateInterviewPrepRequest) => interviewPrepService.generate(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: interviewPrepKeys.lists() });
      queryClient.setQueryData(
        interviewPrepKeys.detail(response.interviewPrep.id),
        response
      );
      queryClient.setQueryData(
        interviewPrepKeys.byApplication(response.interviewPrep.applicationId),
        response
      );
    },
  });
}

/**
 * Update existing interview prep
 */
export function useUpdateInterviewPrep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateInterviewPrepRequest }) =>
      interviewPrepService.update(id, data),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({ queryKey: interviewPrepKeys.detail(variables.id) });
      queryClient.invalidateQueries({
        queryKey: interviewPrepKeys.byApplication(response.interviewPrep.applicationId),
      });
    },
  });
}

/**
 * Delete interview prep
 */
export function useDeleteInterviewPrep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => interviewPrepService.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: interviewPrepKeys.lists() });
      queryClient.removeQueries({ queryKey: interviewPrepKeys.detail(id) });
    },
  });
}

/**
 * Log practice session with optimistic updates
 */
export function useLogPracticeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LogPracticeSessionRequest }) =>
      interviewPrepService.logPracticeSession(id, data),
    onSuccess: (response, variables) => {
      queryClient.setQueryData(interviewPrepKeys.detail(variables.id), response);
      queryClient.invalidateQueries({
        queryKey: interviewPrepKeys.byApplication(response.interviewPrep.applicationId),
      });
    },
  });
}

/**
 * Export quick reference card
 */
export function useExportQuickReference() {
  return useMutation({
    mutationFn: ({
      id,
      format,
      sections,
    }: {
      id: string;
      format: ExportFormat;
      sections?: string;
    }) => interviewPrepService.exportQuickReference(id, format, sections),
  });
}

/**
 * Download quick reference card as file
 */
export function useDownloadQuickReference() {
  return useMutation({
    mutationFn: async ({
      id,
      format,
      sections,
      filename,
    }: {
      id: string;
      format: ExportFormat;
      sections?: string;
      filename?: string;
    }) => {
      const blob = await interviewPrepService.downloadQuickReference(id, format, sections);

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `interview-prep-${format}.${format === 'pdf' ? 'pdf' : 'md'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      return { success: true };
    },
  });
}
