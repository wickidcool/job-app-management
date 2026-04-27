import {
  pgTable,
  text,
  timestamp,
  integer,
  pgEnum,
  jsonb,
  boolean,
  numeric,
  date,
} from 'drizzle-orm/pg-core';

export const appStatusEnum = pgEnum('app_status', [
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
]);

export const applications = pgTable('applications', {
  id: text('id').primaryKey(),
  jobTitle: text('job_title').notNull(),
  company: text('company').notNull(),
  url: text('url'),
  location: text('location'),
  salaryRange: text('salary_range'),
  status: appStatusEnum('status').notNull().default('saved'),
  coverLetterId: text('cover_letter_id'),
  resumeVersionId: text('resume_version_id'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  // UC-5 Extended Tracking Fields
  contact: text('contact'),
  compTarget: text('comp_target'),
  nextAction: text('next_action'),
  nextActionDue: date('next_action_due', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const statusHistory = pgTable('status_history', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  fromStatus: appStatusEnum('from_status'),
  toStatus: appStatusEnum('to_status').notNull(),
  note: text('note'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const resumes = pgTable('resumes', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  filePath: text('file_path').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const resumeExports = pgTable('resume_exports', {
  id: text('id').primaryKey(),
  resumeId: text('resume_id')
    .notNull()
    .references(() => resumes.id, { onDelete: 'cascade' }),
  exportType: text('export_type').notNull().default('star_markdown'),
  filePath: text('file_path').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;
export type ResumeExport = typeof resumeExports.$inferSelect;
export type NewResumeExport = typeof resumeExports.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type StatusHistoryEntry = typeof statusHistory.$inferSelect;
export type NewStatusHistoryEntry = typeof statusHistory.$inferInsert;
export type ApplicationStatus = (typeof appStatusEnum.enumValues)[number];

// Catalog enums
export const jobFitCategoryEnum = pgEnum('job_fit_category', [
  'role',
  'industry',
  'seniority',
  'work_style',
  'uncategorized',
]);

export const techStackCategoryEnum = pgEnum('tech_stack_category', [
  'language',
  'frontend',
  'backend',
  'database',
  'cloud',
  'devops',
  'ai_ml',
  'uncategorized',
]);

export const metricTypeEnum = pgEnum('metric_type', [
  'percentage',
  'currency',
  'count',
  'time',
  'multiplier',
]);

export const impactCategoryEnum = pgEnum('impact_category', [
  'revenue',
  'cost_savings',
  'efficiency',
  'team_leadership',
  'user_growth',
  'performance',
  'other',
]);

export const changeActionEnum = pgEnum('change_action', ['create', 'update', 'delete', 'merge']);

export const diffStatusEnum = pgEnum('diff_status', [
  'pending',
  'approved',
  'rejected',
  'partial',
  'expired',
]);

// Catalog tables
export const companyCatalog = pgTable('company_catalog', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull().unique(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  applicationCount: integer('application_count').notNull().default(0),
  latestStatus: appStatusEnum('latest_status'),
  latestAppId: text('latest_app_id').references(() => applications.id, { onDelete: 'set null' }),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const jobFitTags = pgTable('job_fit_tags', {
  id: text('id').primaryKey(),
  tagSlug: text('tag_slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  category: jobFitCategoryEnum('category').notNull().default('uncategorized'),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  sourceIds: jsonb('source_ids').$type<string[]>().notNull().default([]),
  mentionCount: integer('mention_count').notNull().default(0),
  needsReview: boolean('needs_review').notNull().default(false),
  reviewOptions: jsonb('review_options').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const techStackTags = pgTable('tech_stack_tags', {
  id: text('id').primaryKey(),
  tagSlug: text('tag_slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  category: techStackCategoryEnum('category').notNull().default('uncategorized'),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  sourceIds: jsonb('source_ids').$type<string[]>().notNull().default([]),
  mentionCount: integer('mention_count').notNull().default(0),
  versionMentioned: text('version_mentioned'),
  isLegacy: boolean('is_legacy').notNull().default(false),
  needsReview: boolean('needs_review').notNull().default(false),
  reviewOptions: jsonb('review_options').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const quantifiedBullets = pgTable('quantified_bullets', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  rawText: text('raw_text').notNull(),
  actionVerb: text('action_verb'),
  metricType: metricTypeEnum('metric_type').notNull(),
  metricValue: numeric('metric_value').notNull(),
  metricRange: jsonb('metric_range').$type<[number, number]>(),
  isApproximate: boolean('is_approximate').notNull().default(false),
  secondaryMetricType: metricTypeEnum('secondary_metric_type'),
  secondaryMetricValue: numeric('secondary_metric_value'),
  impactCategory: impactCategoryEnum('impact_category').notNull().default('other'),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const recurringThemes = pgTable('recurring_themes', {
  id: text('id').primaryKey(),
  themeSlug: text('theme_slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  occurrenceCount: integer('occurrence_count').notNull().default(0),
  sourceIds: jsonb('source_ids').$type<string[]>().notNull().default([]),
  exampleExcerpts: jsonb('example_excerpts').$type<string[]>().notNull().default([]),
  isCoreStrength: boolean('is_core_strength').notNull().default(false),
  isHistorical: boolean('is_historical').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const catalogChangeLog = pgTable('catalog_change_log', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: changeActionEnum('action').notNull(),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  triggerSource: text('trigger_source').notNull(),
  triggerId: text('trigger_id'),
  diffId: text('diff_id'),
  committed: boolean('committed').notNull().default(false),
  committedAt: timestamp('committed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const catalogDiffs = pgTable('catalog_diffs', {
  id: text('id').primaryKey(),
  triggerSource: text('trigger_source').notNull(),
  triggerId: text('trigger_id').notNull(),
  summary: text('summary').notNull(),
  changes: jsonb('changes').$type<DiffChange[]>().notNull(),
  pendingReview: jsonb('pending_review').$type<ReviewItem[]>().notNull().default([]),
  status: diffStatusEnum('status').notNull().default('pending'),
  userDecisions: jsonb('user_decisions'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const wikilinkRegistry = pgTable('wikilink_registry', {
  id: text('id').primaryKey(),
  linkText: text('link_text').notNull(),
  normalizedText: text('normalized_text').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  isManual: boolean('is_manual').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Catalog type exports
export interface DiffChange {
  entity: string;
  action: 'create' | 'update' | 'delete' | 'merge';
  data: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface ReviewItem {
  type: 'ambiguous_tag' | 'fuzzy_match' | 'unresolved_wikilink';
  value: string;
  options?: string[];
  confidence?: number;
}

export type CompanyCatalog = typeof companyCatalog.$inferSelect;
export type NewCompanyCatalog = typeof companyCatalog.$inferInsert;
export type JobFitTag = typeof jobFitTags.$inferSelect;
export type NewJobFitTag = typeof jobFitTags.$inferInsert;
export type TechStackTag = typeof techStackTags.$inferSelect;
export type NewTechStackTag = typeof techStackTags.$inferInsert;
export type QuantifiedBullet = typeof quantifiedBullets.$inferSelect;
export type NewQuantifiedBullet = typeof quantifiedBullets.$inferInsert;
export type RecurringTheme = typeof recurringThemes.$inferSelect;
export type NewRecurringTheme = typeof recurringThemes.$inferInsert;
export type CatalogChangeLog = typeof catalogChangeLog.$inferSelect;
export type CatalogDiff = typeof catalogDiffs.$inferSelect;
export type WikilinkRegistry = typeof wikilinkRegistry.$inferSelect;
