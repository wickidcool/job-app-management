import { useMutation, useQuery } from '@tanstack/react-query';
import { jobFitService } from '../services/api';
import type {
  AnalyzeJobFitRequest,
  AnalyzeJobFitResponse,
  ListJobFitAnalysesParams,
} from '../types/jobFit';

/**
 * Query keys for job fit analysis
 */
export const jobFitKeys = {
  all: ['jobFit'] as const,
  analyses: () => [...jobFitKeys.all, 'analysis'] as const,
  list: (params?: ListJobFitAnalysesParams) => [...jobFitKeys.analyses(), 'list', params] as const,
  /**
   * One analysis, by id. Nested under {@link jobFitKeys.analyses} rather than beside it so
   * that invalidating `analyses()` clears the detail entries too — a new analysis for an
   * application changes which one the checklist points at, and a stale detail cached under
   * a sibling prefix would survive that invalidation (WIC-2058).
   */
  detail: (id: string) => [...jobFitKeys.analyses(), 'detail', id] as const,
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

/**
 * List stored job fit analyses (GET /catalog/job-fit/analyses).
 *
 * `enabled` follows the same convention as the other list hooks: a caller whose
 * filter depends on data still in flight passes `false` rather than firing an
 * unfiltered fetch-everything and then refetching.
 *
 * The `applicationId` filter is not a convenience. `job_fit_analyses.application_id`
 * is nullable — an analysis run from `/job-fit-analysis` with no `appId` belongs to
 * no application — so an unfiltered page can consist entirely of rows that could
 * never tick the caller's checklist. Narrowing server-side is the only way the page
 * the caller receives is a page of candidates; a client filter applied after the
 * server has chosen a page can only remove rows, never recover one it did not send
 * (WIC-1652, and the page-cap lesson from WIC-1533).
 */
export function useJobFitAnalyses(
  params?: ListJobFitAnalysesParams,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: jobFitKeys.list(params),
    queryFn: () => jobFitService.listAnalyses(params),
    enabled: options?.enabled ?? true,
  });
}

/**
 * One stored analysis, by id (`GET /catalog/job-fit/analyses/:id`).
 *
 * `enabled: !!id` follows the convention of the other by-id hooks: `useParams` types its
 * result as possibly-`undefined`, and firing a request at `/analyses/undefined` would spend
 * a round trip to be told 404 — which the caller would then render as "not found" for what
 * is really "no id in the URL".
 *
 * `retry: false` is deliberate and is the one place this hook differs from the list. A 404
 * here is the *answer* — the analysis does not exist, or is not yours — not a transient
 * failure, and React Query's default three retries would hold the page on its loading
 * branch for several seconds before showing the not-found copy it already knew to show.
 */
export function useJobFitAnalysisById(id?: string) {
  return useQuery({
    queryKey: jobFitKeys.detail(id ?? ''),
    queryFn: () => jobFitService.getAnalysis(id!),
    enabled: !!id,
    retry: false,
  });
}
