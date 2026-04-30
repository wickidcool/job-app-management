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
  // UC-5 Extended Tracking Fields
  contact?: string;
  compTarget?: string;
  nextAction?: string;
  nextActionDue?: string;
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
  // UC-5 Extended Tracking Fields
  contact?: string;
  compTarget?: string;
  nextAction?: string;
  nextActionDue?: string;
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
  // UC-5 Extended Tracking Fields
  contact?: string;
  compTarget?: string;
  nextAction?: string;
  nextActionDue?: string;
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
    emphasis: CoverLetterEmphasis;
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
    emphasis: CoverLetterEmphasis;
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
  content?: string;
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

/**
 * Resume Variant Types (UC-6)
 */

export type ResumeFormat = 'chronological' | 'functional' | 'hybrid';
export type SectionEmphasis = 'experience_heavy' | 'skills_heavy' | 'balanced';
export type SectionType = 'summary' | 'experience' | 'skills' | 'projects' | 'education' | 'certifications';

export interface SectionBulletSelection {
  sectionId: string;
  bulletIds: string[];
  customBullets?: string[];
}

export interface BulletContent {
  id: string;
  text: string;
  source: 'catalog' | 'custom';
  impactCategory?: string;
}

export interface ExperienceSection {
  id: string;
  company: string;
  role: string;
  location?: string;
  startDate: string;
  endDate?: string;
  bullets: BulletContent[];
}

export interface SkillCategory {
  name: string;
  skills: string[];
}

export interface SkillsSection {
  categories: SkillCategory[];
}

export interface ProjectSection {
  id: string;
  name: string;
  description?: string;
  techStack: string[];
  bullets: BulletContent[];
}

export interface EducationSection {
  institution: string;
  degree: string;
  field?: string;
  graduationDate?: string;
  gpa?: string;
  honors?: string[];
}

export interface ResumeContent {
  summary?: string;
  experience: ExperienceSection[];
  skills: SkillsSection;
  projects?: ProjectSection[];
  education?: EducationSection[];
  certifications?: string[];
}

export interface RevisionEntry {
  id: string;
  instructions: string;
  previousContent: ResumeContent;
  appliedAt: string;
}

export interface ResumeVariant {
  id: string;
  status: 'draft' | 'finalized';
  title: string;
  targetCompany: string;
  targetRole: string;
  format: ResumeFormat;
  sectionEmphasis: SectionEmphasis;
  baseResumeId?: string;
  jobFitAnalysisId?: string;
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  selectedBullets: SectionBulletSelection[];
  selectedTechTags: string[];
  selectedThemes: string[];
  sectionOrder: SectionType[];
  hiddenSections: SectionType[];
  content: ResumeContent;
  revisionHistory: RevisionEntry[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ResumeVariantSummary {
  id: string;
  status: 'draft' | 'finalized';
  title: string;
  targetCompany: string;
  targetRole: string;
  format: ResumeFormat;
  atsScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface UsedBullet {
  id: string;
  rawText: string;
  section: string;
  impactCategory: string;
  relevanceScore: number;
}

export interface GenerationWarning {
  code: string;
  message: string;
}

export interface BulletSuggestion {
  bulletId: string;
  rawText: string;
  impactCategory: string;
  relevanceScore: number;
  matchedKeywords: string[];
  suggestedSection: string;
  reasoning: string;
}

export interface GenerateResumeVariantRequest {
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  jobFitAnalysisId?: string;
  targetCompany?: string;
  targetRole?: string;
  baseResumeId?: string;
  selectedBullets?: SectionBulletSelection[];
  selectedTechTags?: string[];
  selectedThemes?: string[];
  format?: ResumeFormat;
  sectionEmphasis?: SectionEmphasis;
  sectionOrder?: SectionType[];
  hiddenSections?: SectionType[];
  maxBulletsPerRole?: number;
  includeProjects?: boolean;
  atsOptimized?: boolean;
  summaryInstructions?: string;
}

export interface GenerateResumeVariantResponse {
  variant: ResumeVariant;
  usedBullets: UsedBullet[];
  matchedTechTags: string[];
  matchedThemes: string[];
  atsScore?: number;
  warnings: GenerationWarning[];
}

export interface ReviseResumeVariantRequest {
  instructions: string;
  selectedBullets?: SectionBulletSelection[];
  selectedTechTags?: string[];
  sectionOrder?: SectionType[];
  hiddenSections?: SectionType[];
  format?: ResumeFormat;
  sectionEmphasis?: SectionEmphasis;
  version: number;
}

export interface ReviseResumeVariantResponse {
  variant: ResumeVariant;
  changesApplied: string[];
  usedBullets: UsedBullet[];
  atsScore?: number;
}

export interface UpdateResumeVariantRequest {
  title?: string;
  status?: 'draft' | 'finalized';
  version: number;
}

export interface ListResumeVariantsResponse {
  variants: ResumeVariantSummary[];
  nextCursor?: string;
}

export interface GetResumeVariantResponse {
  variant: ResumeVariant;
  usedBullets: UsedBullet[];
  baseResume?: {
    id: string;
    fileName: string;
  };
  jobFitAnalysis?: {
    id: string;
    recommendation: string;
  };
}

export interface SuggestBulletsRequest {
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  jobFitAnalysisId?: string;
  maxBulletsPerSection?: number;
  impactCategories?: string[];
  excludeBulletIds?: string[];
}

export interface SuggestBulletsResponse {
  suggestions: BulletSuggestion[];
  totalCatalogBullets: number;
}

export interface ExportResumeVariantRequest {
  format: 'docx';
  template?: 'modern' | 'classic' | 'minimal' | 'ats_optimized';
  headerInfo: {
    name: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    github?: string;
    location?: string;
    portfolio?: string;
  };
  fontFamily?: 'default' | 'serif' | 'modern';
  fontSize?: 10 | 11 | 12;
  margins?: 'normal' | 'narrow' | 'wide';
  targetPages?: 1 | 2;
}

export interface ExportResumeVariantResponse {
  exportId: string;
  format: 'pdf' | 'docx';
  filename: string;
  fileSize: number;
  base64Content: string;
  pageCount: number;
  createdAt: string;
}
