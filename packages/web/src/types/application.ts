import type { Ratio } from './units';

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
  /**
   * Scheduled interview instant, ISO-8601 **with an offset** — e.g. `2026-09-10T19:30:00.000Z`.
   *
   * Deliberately *not* the `YYYY-MM-DD` contract `nextActionDue` above carries, and the
   * comment is spelled out here so the two are not read as the same kind of field. The column
   * is `TIMESTAMPTZ`, the API validates this as `z.string().datetime({ offset: true })`, and
   * `InterviewPrepCard` does real `getTime()` arithmetic on it for a countdown. A date-only
   * string would be accepted by `new Date` as UTC midnight and silently move the instant.
   * See `utils/datetimeLocal.ts`.
   */
  interviewDate?: string;
}

/**
 * Dashboard Statistics interface
 */
export interface DashboardStats {
  total: number;
  appliedThisWeek: number;
  /** Share of applications that drew a response, as a ratio in [0, 1]. `0.75` means 75%. */
  responseRate: Ratio;
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
  /**
   * Scheduled interview instant, ISO-8601 **with an offset**.
   *
   * The `<input type="datetime-local">` bound to this field holds `YYYY-MM-DDTHH:mm` while
   * the user is editing; `applicationFormSchema` converts that to a full instant on submit,
   * so what a submit handler receives — and what this type describes — is already the wire
   * format. `''` means "no interview scheduled" and clears a previously-stored date.
   */
  interviewDate?: string;
}
