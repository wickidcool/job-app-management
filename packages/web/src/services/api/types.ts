/**
 * API Types based on API_CONTRACTS.md from WIC-17
 * These types match the backend API response structure
 */

import type { Ratio } from '../../types/units';

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
  /**
   * ISO 8601 **instant with an offset**, or `null` when no interview is scheduled.
   *
   * `nextActionDue` above is a bare `YYYY-MM-DD` calendar day; this is not. The API builds
   * it with `.toISOString()` off a `TIMESTAMPTZ` column
   * (`packages/api/src/services/application.service.ts`) and sends an explicit `null`
   * rather than omitting the key. WIC-2188.
   */
  interviewDate?: string | null;
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
  /** ISO 8601 instant with an offset. `''` is accepted and stored as no date. WIC-2188. */
  interviewDate?: string;
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
  /**
   * ISO 8601 instant with an offset.
   *
   * `''` is how a caller **clears** a previously-scheduled date: the route's schema maps it
   * to `undefined` while leaving the key present, and the service's `if ('interviewDate' in
   * input)` then writes `NULL`. Omitting the key leaves the stored date alone — the two are
   * different requests and the distinction is the reason this is not `?: string | undefined`
   * in spirit only. WIC-2188.
   */
  interviewDate?: string;
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
  /** Submissions in the last 7 days, regardless of current status. */
  appliedThisWeek: number;
  /**
   * Submissions in the last **30 days** — a rolling window, not calendar
   * month-to-date. Label it "last 30 days" if you bind it to a surface.
   */
  appliedThisMonth: number;
  /**
   * Share of applications that drew a response, as a **ratio in [0, 1]** —
   * `0.75` means 75%. Source of record for the unit is
   * `docs/architecture/API_CONTRACTS.md` (`GET /dashboard`), which is what the
   * API actually ships.
   *
   * Branded so it cannot be rendered as though it were already a percentage;
   * convert with `toPercent` from `../../types/units` at the display site
   * (WIC-1514).
   */
  responseRate: Ratio;
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
 * A single application referenced by the dashboard attention block.
 *
 * Deliberately minimal: enough to label and link a row, never the full
 * application (`jobDescription` in particular can be very large).
 */
export interface AttentionApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Full-table aggregates behind the Dashboard's "Attention Required" and
 * "Quick Wins" cards.
 *
 * Every `counts` field is computed server-side over *all* of the user's
 * applications, never over a page of them. `samples` are short top-N lists used
 * to render individual action rows; a sample list shorter than its count is
 * expected and does not mean the count is truncated.
 */
export interface DashboardAttention {
  /**
   * The window `/reports/stale` applies by default. The attention card renders
   * this rather than a hardcoded number, so its label can never promise a
   * threshold different from the one the report it links to will apply
   * (WIC-1479).
   */
  staleThresholdDays: number;
  /** Days after which a `saved` application counts as not-yet-submitted. */
  unsubmittedThresholdDays: number;
  counts: {
    interviewing: number;
    /** `applied` or `phone_screen`, not updated within `staleThresholdDays`. */
    stale: number;
    missingJobDescription: number;
    /** `saved`, created over `unsubmittedThresholdDays` ago. Not staleness. */
    unsubmittedSaved: number;
  };
  samples: {
    interviewing: AttentionApplication[];
    stale: AttentionApplication[];
    missingJobDescription: AttentionApplication[];
    unsubmittedSaved: AttentionApplication[];
  };
}

/**
 * Dashboard Response
 */
export interface DashboardResponse {
  stats: DashboardStats;
  recentActivity: ActivityItem[];
  attention: DashboardAttention;
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
 * A single `resume_exports` row, as returned by `GET /resumes/:id/exports`.
 *
 * Deliberately narrower than the `ResumeExport` the UI renders: the table stores
 * no display name, no file size and no experience ids, so those are derived or
 * left undefined by `transformAPIResumeExport` rather than faked. `metadata` is
 * `{ sections, charCount }` today — `charCount` counts characters of the *source*
 * resume text, so it is NOT a file size and must not be rendered as one.
 */
export interface APIResumeExport {
  id: string;
  resumeId: string;
  exportType: string;
  filePath: string;
  generatedAt: string; // ISO 8601
  metadata?: Record<string, unknown> | null;
}

/**
 * List resume exports response
 */
export interface ListResumeExportsResponse {
  exports: APIResumeExport[];
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

/**
 * Mirrors the API's `CoverLetterSummaryDTO` (`packages/api/src/types/index.ts`), which is
 * what `GET /api/cover-letters` returns for each row. Keep the two in step: they are
 * separate `interface` declarations in separate packages, so `tsc` cannot compare them and
 * drift here is silent. This type previously declared a `keywords: string[]` the API has
 * never sent, and omitted `targetCompany`/`targetRole` — the only fields that relate a
 * letter back to the application it was written for (WIC-1533).
 */
export interface CoverLetterSummary {
  id: string;
  status: 'draft' | 'finalized';
  title: string;
  targetCompany: string;
  targetRole: string;
  tone: CoverLetterTone;
  lengthVariant: CoverLetterLength;
  preview: string;
  createdAt: string;
  updatedAt: string;
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
  nextCursor?: string;
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
    // Both are NOT NULL on `cover_letters` and are mapped unconditionally by the API's
    // `toDTO` (cover-letter.service.ts), so they are always present on the wire. They
    // were simply missing from this type, which is why nothing downstream could read
    // the letter's own job context (WIC-1530).
    targetCompany: string;
    targetRole: string;
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
  // `POST /cover-letters/:id/revise` and `POST /cover-letters` return the same server
  // shape — both map the row through `toDTO`. This was a second, hand-copied
  // declaration of it, which is how it came to be missing `targetCompany`/`targetRole`
  // while the generate response was corrected (WIC-1530). Referencing the one
  // declaration keeps the two from drifting apart again.
  coverLetter: GenerateCoverLetterResponse['coverLetter'];
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
  /**
   * How relevant this entry is to the job under analysis. A ratio in `[0, 1]` per ADR-008 §1 —
   * this entry belongs to the job-fit population (`packages/api/src/types/index.ts` →
   * `CatalogEntryDTO`), whose producers all emit `Math.round(x * 100) / 100`. Populated only
   * when the list is fetched in a fit-analysis context; `undefined` otherwise.
   *
   * Branded so it cannot be assigned to a `Percent` sink. Note that the brand does not stop
   * `score >= 80` or `{score}%` — arithmetic and rendering both erase it — so the unit is
   * *also* pinned by `StarEntryPicker.test.tsx`.
   */
  relevanceScore?: Ratio;
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
export type SectionType =
  | 'summary'
  | 'experience'
  | 'skills'
  | 'projects'
  | 'education'
  | 'certifications';

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

/**
 * Personal Information API Types
 */
export interface PersonalInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  websiteUrl?: string;
  professionalSummary?: string;
  headline?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface GetPersonalInfoResponse {
  personalInfo: PersonalInfo;
  isComplete: boolean;
  completionPercentage: number;
}

export interface UpdatePersonalInfoRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  professionalSummary?: string | null;
  headline?: string | null;
  version?: number;
}
