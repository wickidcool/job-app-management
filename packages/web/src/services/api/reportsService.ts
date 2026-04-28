import type { APIClient } from './apiClient';

export type UrgencyLevel = 'overdue' | 'due_soon' | 'upcoming';
export type ActiveStatus = 'saved' | 'applied' | 'phone_screen' | 'interview';
export type FitTier = 'strong_fit' | 'moderate_fit' | 'weak_fit' | 'not_analyzed';
export type ClosedStatus = 'offer' | 'rejected' | 'withdrawn';

export interface PipelineApplication {
  id: string;
  jobTitle: string;
  company: string;
  location?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface PipelineGroup {
  status: ActiveStatus;
  count: number;
  applications: PipelineApplication[];
}

export interface PipelineReportResponse {
  groups: PipelineGroup[];
  totals: {
    active: number;
    byStatus: Partial<Record<ActiveStatus, number>>;
  };
  generatedAt: string;
}

export interface NeedsActionApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  nextAction: string;
  nextActionDue: string;
  daysUntilDue: number;
  urgency: UrgencyLevel;
  contact?: string | null;
  updatedAt: string;
}

export interface NeedsActionReportResponse {
  applications: NeedsActionApplication[];
  summary: {
    overdue: number;
    dueSoon: number;
    upcoming: number;
    total: number;
  };
  nextCursor?: string;
  generatedAt: string;
}

export interface StaleApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  daysSinceUpdate: number;
  lastStatusChange: string;
  contact?: string | null;
  url?: string | null;
  updatedAt: string;
}

export interface StaleReportResponse {
  applications: StaleApplication[];
  summary: {
    total: number;
    byStatus: Partial<Record<string, number>>;
    averageDaysStale: number;
  };
  nextCursor?: string;
  generatedAt: string;
}

export interface ClosedLoopApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: ClosedStatus;
  closedAt: string;
  previousStatus?: string | null;
  daysInPipeline: number;
  salaryRange?: string | null;
  compTarget?: string | null;
}

export interface RejectionStageStats {
  stage: string;
  count: number;
  percentage: number;
}

export interface ClosedLoopReportResponse {
  applications: ClosedLoopApplication[];
  summary: {
    total: number;
    offers: number;
    rejections: number;
    withdrawn: number;
    rejectionsByStage: RejectionStageStats[];
    averageTimeToClose: number;
  };
  nextCursor?: string;
  generatedAt: string;
}

export interface FitTierApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  fitTier: FitTier;
  updatedAt: string;
}

export interface FitTierGroup {
  tier: FitTier;
  count: number;
  applications: FitTierApplication[];
}

export interface ByFitTierReportResponse {
  groups: FitTierGroup[];
  summary: {
    total: number;
    analyzed: number;
    notAnalyzed: number;
    byTier: Partial<Record<FitTier, number>>;
  };
  generatedAt: string;
}

export class ReportsService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  async getPipeline(
    params: { sortBy?: string; sortOrder?: string } = {}
  ): Promise<PipelineReportResponse> {
    const p: Record<string, string> = {};
    if (params.sortBy) p.sortBy = params.sortBy;
    if (params.sortOrder) p.sortOrder = params.sortOrder;
    return this.client.get<PipelineReportResponse>('/reports/pipeline', p);
  }

  async getNeedsAction(
    params: { days?: number; includeOverdue?: boolean; limit?: number; cursor?: string } = {}
  ): Promise<NeedsActionReportResponse> {
    const p: Record<string, string | number> = {};
    if (params.days !== undefined) p.days = params.days;
    if (params.includeOverdue !== undefined) p.includeOverdue = String(params.includeOverdue);
    if (params.limit !== undefined) p.limit = params.limit;
    if (params.cursor) p.cursor = params.cursor;
    return this.client.get<NeedsActionReportResponse>('/reports/needs-action', p);
  }

  async getStale(
    params: { days?: number; status?: string; limit?: number; cursor?: string } = {}
  ): Promise<StaleReportResponse> {
    const p: Record<string, string | number> = {};
    if (params.days !== undefined) p.days = params.days;
    if (params.status) p.status = params.status;
    if (params.limit !== undefined) p.limit = params.limit;
    if (params.cursor) p.cursor = params.cursor;
    return this.client.get<StaleReportResponse>('/reports/stale', p);
  }

  async getClosedLoop(
    params: { period?: string; status?: string; limit?: number; cursor?: string } = {}
  ): Promise<ClosedLoopReportResponse> {
    const p: Record<string, string | number> = {};
    if (params.period) p.period = params.period;
    if (params.status) p.status = params.status;
    if (params.limit !== undefined) p.limit = params.limit;
    if (params.cursor) p.cursor = params.cursor;
    return this.client.get<ClosedLoopReportResponse>('/reports/closed-loop', p);
  }

  async getByFitTier(
    params: { includeTerminal?: boolean; sortBy?: string; sortOrder?: string } = {}
  ): Promise<ByFitTierReportResponse> {
    const p: Record<string, string> = {};
    if (params.includeTerminal !== undefined) p.includeTerminal = String(params.includeTerminal);
    if (params.sortBy) p.sortBy = params.sortBy;
    if (params.sortOrder) p.sortOrder = params.sortOrder;
    return this.client.get<ByFitTierReportResponse>('/reports/by-fit-tier', p);
  }
}

export function createReportsService(client: APIClient): ReportsService {
  return new ReportsService(client);
}
