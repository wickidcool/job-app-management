import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { personalInfoService } from '../services/api';
import type { UpdatePersonalInfoRequest } from '../services/api/types';

/**
 * Query keys for personal info
 */
export const personalInfoKeys = {
  all: ['personalInfo'] as const,
  detail: () => [...personalInfoKeys.all, 'detail'] as const,
};

/**
 * Fetch personal information
 */
export function usePersonalInfo() {
  return useQuery({
    queryKey: personalInfoKeys.detail(),
    queryFn: () => personalInfoService.get(),
  });
}

/**
 * Update personal information
 */
export function useUpdatePersonalInfo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdatePersonalInfoRequest) => personalInfoService.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personalInfoKeys.all });
    },
  });
}

/**
 * Reset personal information
 */
export function useResetPersonalInfo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => personalInfoService.reset(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personalInfoKeys.all });
    },
  });
}

/**
 * Export personal information as vCard
 */
export function useExportVCard() {
  return useMutation({
    mutationFn: async () => {
      const blob = await personalInfoService.exportVCard();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contact.vcf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });
}
