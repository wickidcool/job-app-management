export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export interface ApplicationDTO {
  id: string;
  jobTitle: string;
  company: string;
  url?: string | null;
  location?: string | null;
  salaryRange?: string | null;
  status: ApplicationStatus;
  coverLetterId?: string | null;
  resumeVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string | null;
  version: number;
}

export interface StatusHistoryDTO {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  note?: string | null;
}

export interface CreateApplicationInput {
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  status?: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
}

export interface UpdateApplicationInput {
  jobTitle?: string;
  company?: string;
  url?: string | null;
  location?: string | null;
  salaryRange?: string | null;
  coverLetterId?: string | null;
  resumeVersionId?: string | null;
  version: number;
}

export interface UpdateStatusInput {
  status: ApplicationStatus;
  note?: string;
  version: number;
}

export interface ListApplicationsParams {
  status?: string;
  company?: string;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'company';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
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

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, undefined, 404);
    this.name = 'NotFoundError';
  }
}

export class VersionConflictError extends AppError {
  constructor() {
    super('VERSION_CONFLICT', 'Application was modified by another request', undefined, 409);
    this.name = 'VersionConflictError';
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from: ApplicationStatus, to: ApplicationStatus, allowed: ApplicationStatus[]) {
    super(
      'INVALID_STATUS_TRANSITION',
      `Cannot transition from '${from}' to '${to}'`,
      { currentStatus: from, requestedStatus: to, allowedStatuses: allowed },
      400,
    );
    this.name = 'InvalidTransitionError';
  }
}
