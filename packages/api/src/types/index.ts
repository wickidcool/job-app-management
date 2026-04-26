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
  page?: string;
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

export interface ResumeDTO {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  version: number;
}

export interface ResumeExportDTO {
  id: string;
  resumeId: string;
  exportType: string;
  filePath: string;
  generatedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface UploadResumeResult {
  resume: ResumeDTO;
  export: ResumeExportDTO;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly statusCode: number = 400
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

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, undefined, 409);
    this.name = 'ConflictError';
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
      400
    );
    this.name = 'InvalidTransitionError';
  }
}

// ============================================================================
// Job Fit Analysis (UC-3)
// ============================================================================

export type Seniority =
  | 'entry'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'director'
  | 'vp'
  | 'c_level';

export type FitRecommendation = 'strong_fit' | 'moderate_fit' | 'stretch' | 'low_fit';

export type Confidence = 'high' | 'medium' | 'low';

export type FitMatchType = 'exact' | 'alias' | 'related';

export type FitType = 'tech_stack' | 'job_fit' | 'seniority';

export type GapSeverity = 'critical' | 'moderate' | 'minor';

export interface AnalyzeJobFitInput {
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
}

export interface ParsedJobDescriptionDTO {
  roleTitle: string | null;
  seniority: Seniority | null;
  seniorityConfidence: Confidence;
  requiredStack: string[];
  niceToHaveStack: string[];
  industries: string[];
  teamScope: string | null;
  location: string | null;
  compensation: string | null;
}

export interface FitMatchDTO {
  type: FitType;
  catalogEntry: string;
  jdRequirement: string;
  matchType: FitMatchType;
  isRequired: boolean;
}

export interface FitGapDTO {
  type: FitType;
  jdRequirement: string;
  isRequired: boolean;
  severity: GapSeverity;
}

export interface RecommendedStarEntryDTO {
  id: string;
  rawText: string;
  impactCategory: string;
  relevanceScore: number;
}

export interface AnalyzeJobFitResponse {
  recommendation: FitRecommendation | null;
  summary: string;
  confidence: Confidence;
  parsedJd: ParsedJobDescriptionDTO;
  strongMatches: FitMatchDTO[];
  partialMatches: FitMatchDTO[];
  gaps: FitGapDTO[];
  recommendedStarEntries: RecommendedStarEntryDTO[];
  catalogEmpty: boolean;
  analysisTimestamp: string;
}

export class JobFitInputError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, details, 400);
    this.name = 'JobFitInputError';
  }
}

export class JobFitParseError extends AppError {
  constructor(message: string, details?: unknown) {
    super('JD_PARSE_FAILED', message, details, 422);
    this.name = 'JobFitParseError';
  }
}

export class JobFitUrlFetchError extends AppError {
  constructor(url: string, httpStatus?: number) {
    super(
      'URL_FETCH_FAILED',
      'Could not retrieve job description from URL. The site may be blocking automated access. Please paste the job description text directly.',
      { url, httpStatus },
      422
    );
    this.name = 'JobFitUrlFetchError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super('RATE_LIMIT_EXCEEDED', 'Request rate limit exceeded', { retryAfter }, 429);
    this.name = 'RateLimitError';
  }
}

// ============================================================================
// Catalog Category Constants
// ============================================================================

export const VALID_JOB_FIT_CATEGORIES = [
  'role',
  'industry',
  'seniority',
  'work_style',
  'uncategorized',
] as const;
export const VALID_TECH_STACK_CATEGORIES = [
  'language',
  'frontend',
  'backend',
  'database',
  'cloud',
  'devops',
  'ai_ml',
  'uncategorized',
] as const;

export type JobFitCategory = (typeof VALID_JOB_FIT_CATEGORIES)[number];
export type TechStackCategory = (typeof VALID_TECH_STACK_CATEGORIES)[number];

export function validateTechStackCategory(value: unknown): TechStackCategory {
  if (
    typeof value === 'string' &&
    VALID_TECH_STACK_CATEGORIES.includes(value as TechStackCategory)
  ) {
    return value as TechStackCategory;
  }
  return 'uncategorized';
}

export function validateJobFitCategory(value: unknown): JobFitCategory {
  if (typeof value === 'string' && VALID_JOB_FIT_CATEGORIES.includes(value as JobFitCategory)) {
    return value as JobFitCategory;
  }
  return 'uncategorized';
}

// ============================================================================
// Cover Letters (UC-4)
// ============================================================================

export type CoverLetterStatus = 'draft' | 'finalized';
export type TonePreference = 'professional' | 'conversational' | 'enthusiastic' | 'technical';
export type LengthVariant = 'concise' | 'standard' | 'detailed';
export type OutreachPlatform = 'linkedin' | 'email';

export interface RevisionEntryDTO {
  id: string;
  instructions: string;
  previousContent: string;
  createdAt: string;
}

export interface CoverLetterDTO {
  id: string;
  status: CoverLetterStatus;
  title: string;
  targetCompany: string;
  targetRole: string;
  tone: TonePreference;
  lengthVariant: LengthVariant;
  emphasis: 'technical' | 'leadership' | 'balanced';
  jobDescriptionText?: string | null;
  jobDescriptionUrl?: string | null;
  jobFitAnalysisId?: string | null;
  selectedStarEntryIds: string[];
  content: string;
  revisionHistory: RevisionEntryDTO[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CoverLetterSummaryDTO {
  id: string;
  status: CoverLetterStatus;
  title: string;
  targetCompany: string;
  targetRole: string;
  tone: TonePreference;
  lengthVariant: LengthVariant;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsedStarEntryDTO {
  id: string;
  rawText: string;
  placement: 'opening' | 'body' | 'closing';
}

export interface CatalogEntryDTO {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  tags: string[];
  timeframe?: string;
  relevanceScore?: number;
  relevanceReasoning?: string;
}

export interface GenerationWarningDTO {
  code: string;
  message: string;
}

export interface GenerateCoverLetterInput {
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  jobFitAnalysisId?: string;
  selectedStarEntryIds: string[];
  targetCompany?: string;
  targetRole?: string;
  tone?: TonePreference;
  lengthVariant?: LengthVariant;
  emphasis?: 'technical' | 'leadership' | 'balanced';
  emphasizeThemes?: string[];
  customInstructions?: string;
}

export interface ReviseCoverLetterInput {
  instructions: string;
  selectedStarEntryIds?: string[];
  tone?: TonePreference;
  lengthVariant?: LengthVariant;
  emphasis?: 'technical' | 'leadership' | 'balanced';
  version: number;
}

export interface UpdateCoverLetterInput {
  title?: string;
  content?: string;
  status?: CoverLetterStatus;
  version: number;
}

export interface OutreachMessageDTO {
  id: string;
  platform: OutreachPlatform;
  targetCompany: string;
  targetRole?: string | null;
  subject?: string | null;
  body: string;
  characterCount: number;
  createdAt: string;
}

export interface GenerateOutreachInput {
  platform: OutreachPlatform;
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

export interface ExportCoverLetterInput {
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

export class CoverLetterError extends AppError {
  constructor(code: string, message: string, details?: unknown, statusCode = 400) {
    super(code, message, details, statusCode);
    this.name = 'CoverLetterError';
  }
}
