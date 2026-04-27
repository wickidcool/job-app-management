/**
 * Catalog-related type definitions for UC-2 Catalog Diff Review
 */

export type CatalogEntityType =
  | 'company_catalog'
  | 'tech_stack_tags'
  | 'job_fit_tags'
  | 'quantified_bullets';

export type CatalogChangeAction = 'create' | 'update' | 'delete';

export type AmbiguityType = 'ambiguous_tag' | 'unresolved_wikilink' | 'fuzzy_match';

export interface DiffSummary {
  summary: string;
  totalChanges: number;
  newCount: number;
  updatedCount: number;
  deletedCount: number;
  pendingReviewCount: number;
}

export interface CatalogChange {
  id: string;
  entity: CatalogEntityType;
  action: CatalogChangeAction;
  data: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  sourceId: string;
  sourceName: string;
  selected: boolean;
}

export interface AmbiguityOption {
  id: string;
  label: string;
  description?: string;
  confidence?: number;
}

export interface AmbiguityItem {
  id: string;
  type: AmbiguityType;
  value: string;
  context: string;
  options: AmbiguityOption[];
  sourceId: string;
  sourceName: string;
}

export interface Resolution {
  ambiguityId: string;
  selectedOptionId: string;
}

export interface CatalogDiff {
  id: string;
  summary: DiffSummary;
  changes: CatalogChange[];
  pendingReviews: AmbiguityItem[];
  createdAt: string;
  sourceType: 'resume' | 'application';
  sourceId: string;
}

export interface ApplyDiffRequest {
  changeIds: string[];
  resolutions: Record<string, string>;
}

export interface ApplyDiffResponse {
  success: boolean;
  appliedCount: number;
}

export interface CompanyCatalogEntry {
  id: string;
  name: string;
  normalizedName: string;
  applicationCount: number;
  latestStatus: string;
  firstSeen: string;
}

export interface TechStackTag {
  id: string;
  tag: string;
  displayName: string;
  category: string;
  mentionCount: number;
  yearsExperience?: number;
  sourceIds: string[];
}

export interface JobFitTag {
  id: string;
  tag: string;
  displayName: string;
  category: string;
  mentionCount: number;
  sourceIds: string[];
}

export interface QuantifiedBullet {
  id: string;
  rawText: string;
  actionVerb: string;
  metricType: string;
  metricValue: number;
  impactCategory: string;
  sourceId: string;
  sourceName: string;
}

export type CatalogEntry = CompanyCatalogEntry | TechStackTag | JobFitTag | QuantifiedBullet;

export interface FilterCriteria {
  category?: string;
  impact?: string;
  search?: string;
  [key: string]: unknown;
}
