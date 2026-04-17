export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export type EntityType = 'APPLICATION' | 'STATUS_HISTORY' | 'USER_STATS';

export interface BaseEntity {
  PK: string;
  SK: string;
  entityType: EntityType;
}

export interface ApplicationEntity extends BaseEntity {
  entityType: 'APPLICATION';
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  userId: string;
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

export interface StatusHistoryEntity extends BaseEntity {
  entityType: 'STATUS_HISTORY';
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  note?: string;
}

export interface UserStatsEntity extends BaseEntity {
  entityType: 'USER_STATS';
  counts: Record<ApplicationStatus | 'total', number>;
  appliedThisWeek: number;
  appliedThisMonth: number;
  responseRate: number;
  updatedAt: string;
}

export type Entity = ApplicationEntity | StatusHistoryEntity | UserStatsEntity;
