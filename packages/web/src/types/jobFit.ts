/**
 * Job Fit Analysis type definitions for UC-3
 * Based on API contract in docs/architecture/API_CONTRACTS.md
 */

export type Seniority =
  | 'entry'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'director'
  | 'vp'
  | 'c_level';

export type Confidence = 'high' | 'medium' | 'low';

export type Recommendation = 'strong_fit' | 'moderate_fit' | 'stretch' | 'low_fit' | null;

export type MatchType = 'exact' | 'alias' | 'related';

export type FitMatchType = 'tech_stack' | 'job_fit' | 'seniority';

export type GapSeverity = 'critical' | 'moderate' | 'minor';

/**
 * Request payload for job fit analysis
 */
export interface AnalyzeJobFitRequest {
  jobDescriptionText?: string; // 50-50,000 characters
  jobDescriptionUrl?: string; // Valid URL
  /**
   * The application this analysis is about.
   *
   * Optional, because analysing a bare job description with no application in
   * hand is a supported flow — `/job-fit-analysis` with no `appId` reaches
   * exactly that. An analysis stored without one can never tick any
   * application's checklist, which is why the browser's `appId` has to survive
   * the API boundary rather than being dropped at it (WIC-1652).
   *
   * Not part of the `jobDescriptionText` xor `jobDescriptionUrl` rule the
   * service enforces below: which application this is about is orthogonal to
   * which form the job description arrived in.
   */
  applicationId?: string;
}

/**
 * Parsed job description structure
 */
export interface ParsedJobDescription {
  roleTitle: string | null;
  seniority: Seniority | null;
  seniorityConfidence: Confidence;
  requiredStack: string[]; // Normalized tech stack tags
  niceToHaveStack: string[]; // Normalized tech stack tags
  industries: string[]; // Normalized job fit tags
  teamScope: string | null; // e.g., "IC", "Manager of 5"
  location: string | null;
  compensation: string | null;
}

/**
 * Match between catalog entry and JD requirement
 */
export interface FitMatch {
  type: FitMatchType;
  catalogEntry: string; // Tag slug or display name from catalog
  jdRequirement: string; // Original text from JD
  matchType: MatchType;
  isRequired: boolean; // true if from required stack
}

/**
 * Gap in user's catalog vs JD requirements
 */
export interface FitGap {
  type: FitMatchType;
  jdRequirement: string;
  isRequired: boolean;
  severity: GapSeverity;
}

/**
 * Recommended STAR entry for this job
 */
export interface RecommendedStarEntry {
  id: string;
  rawText: string;
  impactCategory: string;
  relevanceScore: number; // 0-1
}

/**
 * Complete job fit analysis response
 */
export interface AnalyzeJobFitResponse {
  /** The id of the persisted analysis (WIC-1652). */
  id: string;
  /** The application this analysis is about, or `null` for a scratch analysis. */
  applicationId: string | null;
  recommendation: Recommendation;
  /**
   * Weighted required-skill match, 0-100.
   *
   * `null` **exactly when** {@link recommendation} is `null` — the catalog was
   * empty, or the job description named no required skills. That is the
   * *unscored* result, not the absence of an analysis, and `0` is a real score
   * distinct from both. Anything rendering this must test `!= null`, not
   * truthiness.
   */
  fitScore: number | null;
  summary: string;
  confidence: Confidence;

  parsedJd: ParsedJobDescription;

  strongMatches: FitMatch[];
  partialMatches: FitMatch[];
  gaps: FitGap[];
  recommendedStarEntries: RecommendedStarEntry[];

  catalogEmpty: boolean;
  analysisTimestamp: string; // ISO 8601
}

/**
 * A stored analysis as returned by `GET /catalog/job-fit/analyses`.
 *
 * Deliberately a summary and not the whole analysis: the caller this exists for
 * is `ApplicationDetail`'s workflow checklist, which needs to know *whether* an
 * analysis exists and *what it scored*, and would otherwise pull four JSONB
 * payloads per application to render a tick and a percentage (WIC-1652).
 */
export interface JobFitAnalysisSummary {
  id: string;
  /**
   * `null` for an analysis run from `/job-fit-analysis` with no `appId`. Such
   * an analysis carries no application and can never tick a checklist, which is
   * why {@link ListJobFitAnalysesParams.applicationId} is required of a caller
   * that means "this application" — an unfiltered list is not a substitute.
   */
  applicationId: string | null;
  recommendation: Recommendation;
  /** See {@link AnalyzeJobFitResponse.fitScore} — `null` is unscored, not zero. */
  fitScore: number | null;
  summary: string;
  confidence: Confidence;
  catalogEmpty: boolean;
  analyzedAt: string; // ISO 8601
}

export interface ListJobFitAnalysesParams {
  applicationId?: string;
  limit?: number; // 1-100
}

export interface ListJobFitAnalysesResponse {
  /** Newest first. */
  analyses: JobFitAnalysisSummary[];
}

/**
 * `GET /catalog/job-fit/analyses/:id` (WIC-2058).
 *
 * The read-one companion to {@link ListJobFitAnalysesResponse}, carrying the same
 * {@link JobFitAnalysisSummary}. It exists because the list cannot answer "show me *this*
 * analysis": its only exact narrowing is `applicationId`, which `/job-fit-analysis/:id`
 * does not carry, so resolving an id through the list would mean scanning the newest 100
 * rows in the browser — a client filter over a server-chosen page, which can only remove
 * rows and never recover one the server did not send (WIC-1533, WIC-1652).
 *
 * A 404 here means "no such analysis *for you*" and nothing narrower: the server ANDs the
 * owner term into the read, so a stranger's id and a nonexistent one are the same answer.
 */
export interface GetJobFitAnalysisResponse {
  analysis: JobFitAnalysisSummary;
}

/**
 * Job fit analysis error codes
 */
export type JobFitErrorCode =
  | 'JD_INPUT_REQUIRED'
  | 'JD_INPUT_CONFLICT'
  | 'JD_TEXT_TOO_SHORT'
  | 'JD_TEXT_TOO_LONG'
  | 'JD_URL_INVALID'
  | 'JD_PARSE_FAILED'
  | 'URL_FETCH_FAILED'
  | 'URL_FETCH_TIMEOUT'
  | 'RATE_LIMIT_EXCEEDED';

/**
 * Job fit analysis error response
 */
export interface JobFitErrorResponse {
  error: {
    code: JobFitErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}
