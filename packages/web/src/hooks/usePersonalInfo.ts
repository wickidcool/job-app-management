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
