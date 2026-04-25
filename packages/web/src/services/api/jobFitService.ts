import type { APIClient } from './apiClient';
import type {
  AnalyzeJobFitRequest,
  AnalyzeJobFitResponse,
} from '../../types/jobFit';

export interface JobFitService {
  /**
   * Analyze a job description against the user's catalog
   * POST /catalog/job-fit/analyze
   */
  analyze(request: AnalyzeJobFitRequest): Promise<AnalyzeJobFitResponse>;
}

/**
 * Create job fit analysis service
 */
export function createJobFitService(client: APIClient): JobFitService {
  return {
    async analyze(request: AnalyzeJobFitRequest): Promise<AnalyzeJobFitResponse> {
      // Validate mutually exclusive inputs
      if (!request.jobDescriptionText && !request.jobDescriptionUrl) {
        throw new Error('Either jobDescriptionText or jobDescriptionUrl is required');
      }
      if (request.jobDescriptionText && request.jobDescriptionUrl) {
        throw new Error('Only one of jobDescriptionText or jobDescriptionUrl can be provided');
      }

      return client.post<AnalyzeJobFitResponse>('/catalog/job-fit/analyze', request);
    },
  };
}
