/**
 * Application Status Type
 * Represents the current stage of a job application
 */
export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

/**
 * Main Application interface
 */
export interface Application {
  id: string;
  jobTitle: string;
  company: string;
  location?: string;
  salaryRange?: string;
  status: ApplicationStatus;
  hasDocuments: boolean;
  createdAt: Date;
  appliedAt?: Date;
  url?: string;
  jobDescription?: string;
}

/**
 * Dashboard Statistics interface
 */
export interface DashboardStats {
  total: number;
  appliedThisWeek: number;
  responseRate: number; // 0-100
  inReview: number; // phone_screen + interview count
}

/**
 * Status Change History interface
 */
export interface StatusChange {
  status: ApplicationStatus;
  timestamp: Date;
  note?: string;
}

/**
 * Application Form Data interface
 * Used for create/edit form validation
 */
export interface ApplicationFormData {
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  jobDescription?: string;
  status: ApplicationStatus;
  linkCoverLetter?: boolean;
  coverLetterId?: string;
}
