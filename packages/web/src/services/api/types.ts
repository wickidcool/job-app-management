/**
 * API Types based on API_CONTRACTS.md from WIC-17
 * These types match the backend API response structure
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
 * Application entity from API (uses ISO date strings, not Date objects)
 */
export interface APIApplication {
  id: string;
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  jobDescription?: string;
  status: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
  version: number; // For optimistic locking
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  appliedAt?: string; // ISO 8601
}

/**
 * Status history entry
 */
export interface StatusHistoryEntry {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string; // ISO 8601
  note?: string;
}

/**
 * List applications response
 */
export interface ListApplicationsResponse {
  applications: APIApplication[];
  nextPage?: string;
  totalCount: number;
}

/**
 * Get application response (includes status history)
 */
export interface GetApplicationResponse {
  application: APIApplication;
  statusHistory: StatusHistoryEntry[];
}

/**
 * Create application request
 */
export interface CreateApplicationRequest {
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  jobDescription?: string;
  status: ApplicationStatus;
  coverLetterId?: string;
}

/**
 * Update application request
 */
export interface UpdateApplicationRequest {
  jobTitle?: string;
  company?: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  jobDescription?: string;
  status?: ApplicationStatus;
  coverLetterId?: string;
  version: number; // Required for optimistic locking
}

/**
 * Update status request
 */
export interface UpdateStatusRequest {
  status: ApplicationStatus;
  note?: string;
  version: number; // Required for optimistic locking
}

/**
 * API Error Response
 */
export interface APIErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * API Client Configuration
 */
export interface APIConfig {
  baseURL: string;
  getAuthToken: () => Promise<string | null>;
}

/**
 * Dashboard Statistics
 */
export interface DashboardStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  appliedThisWeek: number;
  appliedThisMonth: number;
  responseRate: number;
}

/**
 * Activity Item
 */
export interface ActivityItem {
  applicationId: string;
  jobTitle: string;
  company: string;
  action: 'created' | 'status_changed';
  fromStatus?: ApplicationStatus;
  toStatus: ApplicationStatus;
  timestamp: string; // ISO 8601
}

/**
 * Dashboard Response
 */
export interface DashboardResponse {
  stats: DashboardStats;
  recentActivity: ActivityItem[];
}

/**
 * Resume entity from API
 */
export interface APIResume {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string; // ISO 8601
  version: number;
}

/**
 * List resumes response
 */
export interface ListResumesResponse {
  resumes: APIResume[];
}

/**
 * Cover Letter Types
 */

export type CoverLetterTone = 'professional' | 'conversational' | 'enthusiastic' | 'technical';
export type CoverLetterLength = 'concise' | 'standard' | 'detailed';
export type CoverLetterEmphasis = 'technical' | 'leadership' | 'balanced';

export interface CoverLetterVariant {
  tone: CoverLetterTone;
  length: CoverLetterLength;
  emphasis: CoverLetterEmphasis;
}

export interface CoverLetterSummary {
  id: string;
  title: string;
  keywords: string[];
  createdAt: string;
  preview: string;
}

export interface CoverLetterResult {
  id: string;
  content: string;
  variant: CoverLetterVariant;
  selectedSTARs: string[];
  generatedAt: string;
  applicationId?: string;
}

export interface ListCoverLettersResponse {
  coverLetters: CoverLetterSummary[];
}

/**
 * Cover Letter API Request/Response Types
 */

export interface GenerateCoverLetterRequest {
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  jobFitAnalysisId?: string;
  selectedStarEntryIds: string[];
  targetCompany?: string;
  targetRole?: string;
  tone?: CoverLetterTone;
  lengthVariant?: CoverLetterLength;
  emphasis?: CoverLetterEmphasis;
  emphasizeThemes?: string[];
  customInstructions?: string;
}

export interface GenerateCoverLetterResponse {
  coverLetter: {
    id: string;
    title: string;
    content: string;
    tone: CoverLetterTone;
    lengthVariant: CoverLetterLength;
    wordCount: number;
    selectedStarEntryIds: string[];
    status: 'draft' | 'finalized';
    version: number;
    createdAt: string;
    updatedAt: string;
  };
}

export interface ReviseCoverLetterRequest {
  instructions: string;
  selectedStarEntryIds?: string[];
  tone?: CoverLetterTone;
  lengthVariant?: CoverLetterLength;
  version: number;
}

export interface ReviseCoverLetterResponse {
  coverLetter: {
    id: string;
    title: string;
    content: string;
    tone: CoverLetterTone;
    lengthVariant: CoverLetterLength;
    wordCount: number;
    selectedStarEntryIds: string[];
    status: 'draft' | 'finalized';
    version: number;
    createdAt: string;
    updatedAt: string;
  };
}

export interface UpdateCoverLetterRequest {
  title?: string;
  status?: 'draft' | 'finalized';
  version: number;
}

export interface GenerateOutreachRequest {
  platform: 'linkedin' | 'email';
  targetName?: string;
  targetTitle?: string;
  targetCompany: string;
  targetRole?: string;
  coverLetterId?: string;
  jobFitAnalysisId?: string;
  selectedStarEntryIds?: string[];
  keyPoints?: string[];
  callToAction?: 'coffee_chat' | 'referral' | 'application_follow_up' | 'informational';
  maxLength?: number;
}

export interface GenerateOutreachResponse {
  message: OutreachMessage;
}

export interface ExportCoverLetterRequest {
  format: 'docx';
  includeHeader?: boolean;
  headerInfo?: {
    name: string;
    email?: string;
    phone?: string;
    linkedin?: string;
  };
  fontSize?: 11 | 12;
}

export interface ExportCoverLetterResponse {
  exportId: string;
  format: 'docx';
  filename: string;
  fileSize: number;
  base64Content: string;
  createdAt: string;
}

/**
 * Catalog / STAR Entry Types
 */

export interface CatalogEntry {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  tags: string[];
  timeframe?: string;
  relevanceScore?: number; // For fit analysis context
  relevanceReasoning?: string;
}

export interface ListCatalogEntriesResponse {
  entries: CatalogEntry[];
}

/**
 * Outreach Types
 */

export type OutreachPlatform = 'linkedin' | 'email';

export interface OutreachMessage {
  platform: OutreachPlatform;
  subject?: string; // Email only
  body: string;
  characterCount: number;
  generatedAt: string;
}
