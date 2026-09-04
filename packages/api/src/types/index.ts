import type { Ratio } from './units.js';

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
  // UC-5 Extended Tracking Fields
  contact?: string | null;
  compTarget?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  jobDescription?: string | null;
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
  // UC-5 Extended Tracking Fields
  contact?: string;
  compTarget?: string;
  nextAction?: string;
  nextActionDue?: string;
  jobDescription?: string;
}

export interface UpdateApplicationInput {
  jobTitle?: string;
  company?: string;
  url?: string | null;
  location?: string | null;
  salaryRange?: string | null;
  coverLetterId?: string | null;
  resumeVersionId?: string | null;
  // UC-5 Extended Tracking Fields
  contact?: string | null;
  compTarget?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  jobDescription?: string | null;
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
  /**
   * Applications whose `appliedAt` falls in the last 7 days, **regardless of
   * current status** — a count of submissions, not of applications still
   * sitting at `applied`. Advancing an application never decreases it.
   */
  appliedThisWeek: number;
  /**
   * Applications whose `appliedAt` falls in the last **30 days** — a fixed
   * rolling window, NOT calendar month-to-date. Any surface that renders this
   * must label it "last 30 days"; "this month" would be untrue.
   */
  appliedThisMonth: number;
  /**
   * Share of applications that drew a response, as a **ratio in [0, 1]**,
   * rounded to two decimal places. `0.75` means 75%.
   *
   * The ratio is the contract (`docs/architecture/API_CONTRACTS.md`,
   * `GET /dashboard`) and consumers convert for display. Do not scale to 0-100
   * here: the web client brands this field as `Ratio` and multiplies by 100 at
   * its render site, so a percentage sent from here renders 100x too large
   * (WIC-1514).
   */
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

/**
 * A single application referenced by the dashboard attention block.
 *
 * Deliberately minimal: the dashboard only needs enough to label and link a row,
 * never the full DTO (`jobDescription` in particular can be very large).
 */
export interface AttentionApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full-table aggregates behind the Dashboard's "Attention Required" and
 * "Quick Wins" cards.
 *
 * Every `counts` field is computed over *all* of the user's applications, not
 * over a page of them. `samples` are short top-N lists used to render
 * individual action rows; a sample list being shorter than its count is
 * expected and is not truncation of the count.
 */
export interface DashboardAttention {
  /**
   * The window `/reports/stale` applies by default. Sent down the wire so the
   * dashboard's label always states the threshold the report will actually use
   * (WIC-1479).
   */
  staleThresholdDays: number;
  /** Days after which a `saved` application counts as not-yet-submitted. */
  unsubmittedThresholdDays: number;
  counts: {
    /** `phone_screen` + `interview`. */
    interviewing: number;
    /**
     * `applied` or `phone_screen`, not updated within `staleThresholdDays`.
     *
     * This is the product's one definition of stale, shared with
     * `/reports/stale` — the surface the attention card links to. See
     * `services/stale.ts`.
     */
    stale: number;
    /** Non-terminal and missing a job description. */
    missingJobDescription: number;
    /**
     * `saved` and created more than `unsubmittedThresholdDays` ago. Keyed off
     * `createdAt`, and deliberately *not* called stale: nothing was submitted,
     * so there is nobody to follow up with.
     */
    unsubmittedSaved: number;
  };
  samples: {
    interviewing: AttentionApplication[];
    stale: AttentionApplication[];
    missingJobDescription: AttentionApplication[];
    unsubmittedSaved: AttentionApplication[];
  };
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

export interface ParsedExperience {
  company: string;
  role: string;
  period: string;
  bullets: string[];
}

export interface ParseDebugInfo {
  aiAvailable: boolean;
  usedAI: boolean;
  sectionCount: number;
  sectionHeadings: string[];
  experienceEntryCount: number;
  companiesAddedToCatalog: string[];
  aiError?: string;
  isDuplicate?: boolean;
}

export interface UploadResumeResult {
  resume: ResumeDTO;
  export: ResumeExportDTO;
  experiences: ParsedExperience[];
  education: string[];
  skills: string[];
  parseDebug: ParseDebugInfo;
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
  /**
   * The application this analysis is about (WIC-1652).
   *
   * Optional, because analysing a bare job description with no application in
   * hand is a supported flow. When supplied it is validated against the
   * caller's own applications — an id that names an application they do not own
   * is rejected exactly as one that does not exist, so this is not an existence
   * oracle. Only an analysis carrying an application can ever tick that
   * application's workflow checklist.
   */
  applicationId?: string;
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
  /**
   * The id of the persisted analysis (WIC-1652).
   *
   * Before this field existed the response was unaddressable: the caller could
   * not name the analysis it had just paid an LLM call and a rate-limit slot
   * for, so `jobFitAnalysisId` on the generation endpoints could never be
   * populated honestly by any client.
   */
  id: string;
  /** The application this analysis is about, or `null` for a scratch analysis. */
  applicationId: string | null;
  recommendation: FitRecommendation | null;
  /**
   * Weighted required-skill match, 0-100.
   *
   * This is the `matchPct` the UC-3 scoring algorithm already computes and used
   * to discard — exact matches count 1, partial (alias/related) matches count
   * 0.5, over `parsedJd.requiredStack.length`. It is therefore not a second,
   * independent score that could disagree with `recommendation`; the two are
   * read off the same number.
   *
   * `null` exactly when `recommendation` is `null` — the "unscored" result, not
   * the absence of an analysis.
   */
  fitScore: number | null;
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

/**
 * A stored analysis as returned by `GET /api/catalog/job-fit/analyses`.
 *
 * Deliberately a summary rather than the whole analysis: the caller this exists
 * for is the application workflow checklist, which needs to know *whether* an
 * analysis exists and *what it scored*, and would otherwise pull four JSONB
 * payloads per application to render a tick and a percentage.
 */
export interface JobFitAnalysisSummaryDTO {
  id: string;
  applicationId: string | null;
  recommendation: FitRecommendation | null;
  fitScore: number | null;
  summary: string;
  confidence: Confidence;
  catalogEmpty: boolean;
  analyzedAt: string;
}

export interface ListJobFitAnalysesParams {
  applicationId?: string;
  limit?: number;
}

export interface ListJobFitAnalysesResponse {
  analyses: JobFitAnalysisSummaryDTO[];
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
  applicationId?: string | null;
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
  applicationId?: string | null;
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
  /**
   * How relevant this entry is to the job under analysis. A ratio in `[0, 1]` per ADR-008 §1,
   * mirroring `CatalogEntry.relevanceScore` on the web side.
   *
   * Populated only when `listStarEntries` is called with a `jobFitAnalysisId`, by joining the
   * stored analysis's `recommendedStarEntries` on entry id. Both sides read `quantified_bullets`,
   * so the two id spaces are the same one. `undefined` means "not scored in this request" — it is
   * not a score of zero, and `StarEntryPicker` filters on it rather than ordering by it.
   */
  relevanceScore?: Ratio;
  /**
   * Why the entry is relevant, for display under the score.
   *
   * ⚠ No producer today. `RecommendedStarEntryDTO` carries `id`, `rawText`, `impactCategory` and
   * `relevanceScore` — there is no reasoning column to join, and recomputing one here would make
   * this a second, silently divergent implementation of the scorer in `job-fit.service.ts`.
   * `StarEntryPicker` already guards the render on truthiness, so it stays dark until the
   * analysis stores a reason (WIC-1820 follow-up). Do not populate it by re-deriving it.
   */
  relevanceReasoning?: string;
}

export interface GenerationWarningDTO {
  code: string;
  message: string;
}

export interface GenerateCoverLetterInput {
  applicationId?: string;
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

// ============================================================================
// Reports (UC-5)
// ============================================================================

export type ActiveStatus = 'saved' | 'applied' | 'phone_screen' | 'interview';

/**
 * The fit verdict for one application, as reported across a whole pipeline.
 *
 * **`FitTier` is `FitRecommendation` plus the two states an analysis result can
 * be in when there is no verdict.** It is written as a union of the UC-3 type on
 * purpose (WIC-1298): a report groups applications by the judgement UC-3 made,
 * so the two must not be able to drift. Add a member to `FitRecommendation` and
 * it appears here automatically — and `FIT_TIER_ORDER` in `reports.service.ts`
 * fails to compile until it is ranked.
 *
 * Until WIC-1298 this was its own four-member vocabulary — `strong_fit |
 * moderate_fit | weak_fit | not_analyzed` — which agreed with
 * `FitRecommendation` at the top and diverged at the bottom, with no mapping
 * written down anywhere. Two things were wrong with it:
 *
 * - **`weak_fit` collapsed `stretch` into `low_fit`.** `stretch` is not a
 *   magnitude: it fires on a *seniority* mismatch even at a good skill match
 *   (`computeRecommendation` in `job-fit.service.ts`). Reporting that as "weak"
 *   tells the user their skills are short when the finding was that the level is
 *   wrong — the opposite action. `stretch` and `low_fit` are now distinct tiers.
 * - **`not_analyzed` absorbed `recommendation: null`.** "No analysis has ever
 *   run" and "an analysis ran and could not score" are different facts and want
 *   different prompts. The latter is now `unscored`.
 *
 * `recommendationToFitTier()` in `reports.service.ts` is the single place the
 * two vocabularies meet. Both are wire values: changing a member versions
 * `GET /api/reports/by-fit-tier` and `POST /api/catalog/job-fit/analyze`.
 * Display labels are decoupled (`packages/web/src/constants/fitLevel.ts`).
 */
export type FitTier =
  | FitRecommendation
  /** An analysis ran but produced no verdict (`recommendation: null`). */
  | 'unscored'
  /** No fit analysis has ever been run for this application. */
  | 'not_analyzed';

export interface PipelineApplication {
  id: string;
  jobTitle: string;
  company: string;
  location?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface PipelineGroup {
  status: ActiveStatus;
  count: number;
  applications: PipelineApplication[];
}

export interface PipelineReportResponse {
  groups: PipelineGroup[];
  totals: {
    active: number;
    byStatus: Partial<Record<ActiveStatus, number>>;
  };
  generatedAt: string;
}

export interface NeedsActionApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  nextAction: string;
  nextActionDue: string;
  daysUntilDue: number;
  urgency: 'overdue' | 'due_soon' | 'upcoming';
  contact?: string | null;
  updatedAt: string;
}

export interface NeedsActionReportResponse {
  applications: NeedsActionApplication[];
  summary: {
    overdue: number;
    dueSoon: number;
    upcoming: number;
    total: number;
  };
  nextCursor?: string;
  generatedAt: string;
}

export interface StaleApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  daysSinceUpdate: number;
  lastStatusChange: string;
  contact?: string | null;
  url?: string | null;
  updatedAt: string;
}

export interface StaleReportResponse {
  applications: StaleApplication[];
  summary: {
    total: number;
    byStatus: Partial<Record<ApplicationStatus, number>>;
    averageDaysStale: number;
  };
  nextCursor?: string;
  generatedAt: string;
}

export interface RejectionStageStats {
  stage: ApplicationStatus;
  count: number;
  percentage: number;
}

export interface ClosedLoopApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: 'rejected' | 'offer' | 'withdrawn';
  closedAt: string;
  previousStatus?: ApplicationStatus | null;
  daysInPipeline: number;
  salaryRange?: string | null;
  compTarget?: string | null;
}

export interface ClosedLoopReportResponse {
  applications: ClosedLoopApplication[];
  summary: {
    total: number;
    offers: number;
    rejections: number;
    withdrawn: number;
    rejectionsByStage: RejectionStageStats[];
    averageTimeToClose: number;
  };
  nextCursor?: string;
  generatedAt: string;
}

export interface FitTierApplication {
  id: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  fitTier: FitTier;
  updatedAt: string;
}

export interface FitTierGroup {
  tier: FitTier;
  count: number;
  applications: FitTierApplication[];
}

export interface ByFitTierReportResponse {
  groups: FitTierGroup[];
  summary: {
    total: number;
    analyzed: number;
    notAnalyzed: number;
    byTier: Partial<Record<FitTier, number>>;
  };
  generatedAt: string;
}

export interface PipelineParams {
  sortBy?: 'updatedAt' | 'createdAt' | 'company';
  sortOrder?: 'asc' | 'desc';
}

export interface NeedsActionParams {
  days?: number;
  includeOverdue?: boolean;
  limit?: number;
  cursor?: string;
}

export interface StaleParams {
  days?: number;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface ClosedLoopParams {
  period?: '30d' | '60d' | '90d' | 'all';
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface FitTierParams {
  includeTerminal?: boolean;
  sortBy?: 'updatedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Resume Variants (UC-6)
// ============================================================================

export type ResumeFormat = 'chronological' | 'functional' | 'hybrid';
export type SectionEmphasis = 'experience_heavy' | 'skills_heavy' | 'balanced';
export type SectionType =
  | 'summary'
  | 'experience'
  | 'skills'
  | 'projects'
  | 'education'
  | 'certifications';

export interface SectionBulletSelectionDTO {
  sectionId: string;
  bulletIds: string[];
}

export interface BulletContentDTO {
  id: string;
  text: string;
  source: 'catalog' | 'custom';
  impactCategory?: string;
}

export interface ExperienceSectionDTO {
  id: string;
  company: string;
  role: string;
  location?: string;
  startDate: string;
  endDate?: string;
  bullets: BulletContentDTO[];
}

export interface SkillCategoryDTO {
  name: string;
  skills: string[];
}

export interface SkillsSectionDTO {
  categories: SkillCategoryDTO[];
}

export interface ProjectSectionDTO {
  id: string;
  name: string;
  description?: string;
  techStack: string[];
  bullets: BulletContentDTO[];
}

export interface EducationSectionDTO {
  institution: string;
  degree: string;
  field?: string;
  graduationDate?: string;
  gpa?: string;
  honors?: string[];
}

export interface ResumeContentDTO {
  summary?: string;
  experience: ExperienceSectionDTO[];
  skills: SkillsSectionDTO;
  projects?: ProjectSectionDTO[];
  education?: EducationSectionDTO[];
  certifications?: string[];
}

export interface VariantRevisionEntryDTO {
  id: string;
  instructions: string;
  previousContent: ResumeContentDTO;
  appliedAt: string;
}

export interface ResumeVariantDTO {
  id: string;
  applicationId?: string | null;
  status: 'draft' | 'finalized';
  title: string;
  targetCompany: string;
  targetRole: string;
  format: ResumeFormat;
  sectionEmphasis: SectionEmphasis;
  baseResumeId?: string | null;
  jobFitAnalysisId?: string | null;
  jobDescriptionText?: string | null;
  jobDescriptionUrl?: string | null;
  selectedBullets: SectionBulletSelectionDTO[];
  selectedTechTags: string[];
  selectedThemes: string[];
  sectionOrder: string[];
  hiddenSections: string[];
  content: ResumeContentDTO;
  atsScore?: number | null;
  revisionHistory: VariantRevisionEntryDTO[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ResumeVariantSummaryDTO {
  id: string;
  applicationId?: string | null;
  status: 'draft' | 'finalized';
  title: string;
  targetCompany: string;
  targetRole: string;
  format: ResumeFormat;
  atsScore?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsedBulletDTO {
  id: string;
  rawText: string;
  section: string;
  impactCategory: string;
  relevanceScore: number;
}

export interface VariantGenerationWarningDTO {
  code: string;
  message: string;
}

export interface GenerateResumeVariantInput {
  applicationId?: string;
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  jobFitAnalysisId?: string;
  targetCompany?: string;
  targetRole?: string;
  baseResumeId?: string;
  selectedBullets?: SectionBulletSelectionDTO[];
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

export interface ReviseResumeVariantInput {
  instructions: string;
  selectedBullets?: SectionBulletSelectionDTO[];
  selectedTechTags?: string[];
  sectionOrder?: SectionType[];
  hiddenSections?: SectionType[];
  format?: ResumeFormat;
  sectionEmphasis?: SectionEmphasis;
  version: number;
}

export interface UpdateResumeVariantInput {
  title?: string;
  status?: 'draft' | 'finalized';
  version: number;
}

export interface SuggestBulletsInput {
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  jobFitAnalysisId?: string;
  maxBulletsPerSection?: number;
  impactCategories?: string[];
  excludeBulletIds?: string[];
}

export interface BulletSuggestionDTO {
  bulletId: string;
  rawText: string;
  impactCategory: string;
  relevanceScore: number;
  matchedKeywords: string[];
  suggestedSection: string;
  reasoning: string;
}

export interface ExportResumeVariantInput {
  format: 'pdf' | 'docx';
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

export class ResumeVariantError extends AppError {
  constructor(code: string, message: string, details?: unknown, statusCode = 400) {
    super(code, message, details, statusCode);
    this.name = 'ResumeVariantError';
  }
}
