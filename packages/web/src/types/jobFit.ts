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
  recommendation: Recommendation;
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
