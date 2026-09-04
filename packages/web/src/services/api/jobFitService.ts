import type { APIClient } from './apiClient';
import type {
  AnalyzeJobFitRequest,
  AnalyzeJobFitResponse,
  GetJobFitAnalysisResponse,
  ListJobFitAnalysesParams,
  ListJobFitAnalysesResponse,
} from '../../types/jobFit';

export interface JobFitService {
  /**
   * Analyze a job description against the user's catalog
   * POST /catalog/job-fit/analyze
   */
  analyze(request: AnalyzeJobFitRequest): Promise<AnalyzeJobFitResponse>;
  /**
   * List stored analyses for the caller, newest first.
   * GET /catalog/job-fit/analyses
   */
  listAnalyses(params?: ListJobFitAnalysesParams): Promise<ListJobFitAnalysesResponse>;
  /**
   * One stored analysis, by id.
   * GET /catalog/job-fit/analyses/:id
   */
  getAnalysis(id: string): Promise<GetJobFitAnalysisResponse>;
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

    async listAnalyses(params: ListJobFitAnalysesParams = {}): Promise<ListJobFitAnalysesResponse> {
      // `applicationId` is forwarded rather than filtered on the client: an
      // analysis carrying no application is a supported, and common, row, so an
      // unfiltered page can be entirely rows that could never match. Narrowing
      // after the server has already chosen a page can only remove rows, never
      // recover one it did not send (WIC-1533).
      return client.get<ListJobFitAnalysesResponse>('/catalog/job-fit/analyses', {
        applicationId: params.applicationId,
        limit: params.limit,
      });
    },

    async getAnalysis(id: string): Promise<GetJobFitAnalysisResponse> {
      // A real read-one, not `listAnalyses` narrowed on the client. The list has no `id`
      // filter — its only exact narrowing is `applicationId`, which the viewer route does
      // not carry — so an id resolved through it would be a scan of whatever page the
      // server chose, and an analysis outside that page would read as "not found" while
      // sitting in the table (WIC-2058, and the page-cap lesson from WIC-1533).
      return client.get<GetJobFitAnalysisResponse>(`/catalog/job-fit/analyses/${id}`);
    },
  };
}
