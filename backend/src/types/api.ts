import { ApplicationStatus } from './entities';

// === Application (API shape — no DynamoDB keys) ===

export interface Application {
  id: string;
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  status: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  version: number;
}

export interface StatusHistoryEntry {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  note?: string;
}

// === Request types ===

export interface CreateApplicationRequest {
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  status?: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
}

export interface UpdateApplicationRequest {
  jobTitle?: string;
  company?: string;
  url?: string | null;
  location?: string | null;
  salaryRange?: string | null;
  coverLetterId?: string | null;
  resumeVersionId?: string | null;
  version: number;
}

export interface UpdateStatusRequest {
  status: ApplicationStatus;
  note?: string;
  version: number;
}

export interface ListApplicationsParams {
  status?: string;       // comma-separated statuses
  company?: string;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'company';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

// === Response types ===

export interface ListApplicationsResponse {
  applications: Application[];
  nextCursor?: string;
  totalCount: number;
}

export interface GetApplicationResponse {
  application: Application;
  statusHistory: StatusHistoryEntry[];
}

export interface CreateApplicationResponse {
  application: Application;
}

export interface UpdateApplicationResponse {
  application: Application;
}

export interface UpdateStatusResponse {
  application: Application;
  statusHistory: StatusHistoryEntry[];
}

export interface DashboardStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  appliedThisWeek: number;
  appliedThisMonth: number;
  responseRate: number;
}

export interface ActivityItem {
  applicationId: string;
  jobTitle: string;
  company: string;
  action: 'created' | 'status_changed';
  fromStatus?: ApplicationStatus;
  toStatus: ApplicationStatus;
  timestamp: string;
}

export interface DashboardResponse {
  stats: DashboardStats;
  recentActivity: ActivityItem[];
}

// === Error response ===

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
