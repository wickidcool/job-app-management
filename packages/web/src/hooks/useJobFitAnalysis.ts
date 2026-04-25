import { useMutation } from '@tanstack/react-query';
import { jobFitService } from '../services/api';
import type { AnalyzeJobFitRequest, AnalyzeJobFitResponse } from '../types/jobFit';

/**
 * Query keys for job fit analysis
 */
export const jobFitKeys = {
  all: ['jobFit'] as const,
  analyses: () => [...jobFitKeys.all, 'analysis'] as const,
};

/**
 * Analyze job fit (POST /catalog/job-fit/analyze)
 * Returns a mutation for analyzing job descriptions
 */
export function useJobFitAnalysis() {
  return useMutation<AnalyzeJobFitResponse, Error, AnalyzeJobFitRequest>({
    mutationFn: (request: AnalyzeJobFitRequest) => jobFitService.analyze(request),
  });
}
