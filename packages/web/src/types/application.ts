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
  version: number; // For optimistic locking
  createdAt: Date;
  updatedAt: Date;
  appliedAt?: Date;
  url?: string;
  jobDescription?: string;
  // UC-5 Extended Tracking Fields
  contact?: string; // Recruiter/hiring manager name (max 200)
  compTarget?: string; // User's compensation target
  nextAction?: string; // Next action description (max 500)
  nextActionDue?: string; // ISO date (YYYY-MM-DD)
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
  // UC-5 Extended Tracking Fields
  contact?: string;
  compTarget?: string;
  nextAction?: string;
  nextActionDue?: string;
}
