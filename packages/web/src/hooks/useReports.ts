import { useQuery } from '@tanstack/react-query';
import { reportsService } from '../services/api';

export const reportKeys = {
  all: ['reports'] as const,
  pipeline: (params?: object) => [...reportKeys.all, 'pipeline', params] as const,
  needsAction: (params?: object) => [...reportKeys.all, 'needs-action', params] as const,
  stale: (params?: object) => [...reportKeys.all, 'stale', params] as const,
  closedLoop: (params?: object) => [...reportKeys.all, 'closed-loop', params] as const,
  byFitTier: (params?: object) => [...reportKeys.all, 'by-fit-tier', params] as const,
};

export function useReportsPipeline(params: { sortBy?: string; sortOrder?: string } = {}) {
  return useQuery({
    queryKey: reportKeys.pipeline(params),
    queryFn: () => reportsService.getPipeline(params),
  });
}

export function useReportsNeedsAction(
  params: { days?: number; includeOverdue?: boolean; limit?: number; cursor?: string } = {}
) {
  return useQuery({
    queryKey: reportKeys.needsAction(params),
    queryFn: () => reportsService.getNeedsAction(params),
  });
}

export function useReportsStale(
  params: { days?: number; status?: string; limit?: number; cursor?: string } = {}
) {
  return useQuery({
    queryKey: reportKeys.stale(params),
    queryFn: () => reportsService.getStale(params),
  });
}

export function useReportsClosedLoop(
  params: { period?: string; status?: string; limit?: number; cursor?: string } = {}
) {
  return useQuery({
    queryKey: reportKeys.closedLoop(params),
    queryFn: () => reportsService.getClosedLoop(params),
  });
}

export function useReportsByFitTier(
  params: { includeTerminal?: boolean; sortBy?: string; sortOrder?: string } = {}
) {
  return useQuery({
    queryKey: reportKeys.byFitTier(params),
    queryFn: () => reportsService.getByFitTier(params),
  });
}
