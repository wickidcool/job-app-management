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
  uuid,
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
  userId: uuid('user_id'),
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
  jobDescription: text('job_description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const statusHistory = pgTable('status_history', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  filePath: text('file_path').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const resumeExports = pgTable('resume_exports', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  resumeId: text('resume_id')
    .notNull()
    .references(() => resumes.id, { onDelete: 'cascade' }),
  exportType: text('export_type').notNull().default('star_markdown'),
  filePath: text('file_path').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
});

// Onboarding enum and table
export const onboardingStepEnum = pgEnum('onboarding_step', [
  'welcome',
  'personal_info',
  'resume_upload',
  'first_application',
  'completed',
]);

export const onboardingStatus = pgTable('onboarding_status', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().unique(),
  currentStep: onboardingStepEnum('current_step').notNull().default('welcome'),
  personalInfoStepCompleted: boolean('personal_info_step_completed').notNull().default(false),
  personalInfoStepSkipped: boolean('personal_info_step_skipped').notNull().default(false),
  resumeStepCompleted: boolean('resume_step_completed').notNull().default(false),
  resumeStepSkipped: boolean('resume_step_skipped').notNull().default(false),
  applicationStepCompleted: boolean('application_step_completed').notNull().default(false),
  applicationStepSkipped: boolean('application_step_skipped').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
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
export type OnboardingStatus = typeof onboardingStatus.$inferSelect;
export type NewOnboardingStatus = typeof onboardingStatus.$inferInsert;
export type OnboardingStep = (typeof onboardingStepEnum.enumValues)[number];
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
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
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
  userId: uuid('user_id'),
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

// Cover letter enums
export const coverLetterStatusEnum = pgEnum('cover_letter_status', ['draft', 'finalized']);
export const tonePreferenceEnum = pgEnum('tone_preference', [
  'professional',
  'conversational',
  'enthusiastic',
  'technical',
]);
export const lengthVariantEnum = pgEnum('length_variant', ['concise', 'standard', 'detailed']);
export const emphasisPreferenceEnum = pgEnum('emphasis_preference', [
  'technical',
  'leadership',
  'balanced',
]);
export const outreachPlatformEnum = pgEnum('outreach_platform', ['linkedin', 'email']);

export interface RevisionEntry {
  id: string;
  instructions: string;
  previousContent: string;
  createdAt: string;
}

export const coverLetters = pgTable('cover_letters', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  status: coverLetterStatusEnum('status').notNull().default('draft'),
  title: text('title').notNull(),
  targetCompany: text('target_company').notNull(),
  targetRole: text('target_role').notNull(),
  tone: tonePreferenceEnum('tone').notNull().default('professional'),
  lengthVariant: lengthVariantEnum('length_variant').notNull().default('standard'),
  emphasis: emphasisPreferenceEnum('emphasis').notNull().default('balanced'),
  jobDescriptionText: text('job_description_text'),
  jobDescriptionUrl: text('job_description_url'),
  jobFitAnalysisId: text('job_fit_analysis_id'),
  selectedStarEntryIds: jsonb('selected_star_entry_ids').$type<string[]>().notNull().default([]),
  content: text('content').notNull(),
  revisionHistory: jsonb('revision_history').$type<RevisionEntry[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const outreachMessages = pgTable('outreach_messages', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  platform: outreachPlatformEnum('platform').notNull(),
  targetCompany: text('target_company').notNull(),
  targetRole: text('target_role'),
  targetName: text('target_name'),
  targetTitle: text('target_title'),
  coverLetterId: text('cover_letter_id').references(() => coverLetters.id, {
    onDelete: 'set null',
  }),
  jobFitAnalysisId: text('job_fit_analysis_id'),
  subject: text('subject'),
  body: text('body').notNull(),
  characterCount: integer('character_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CoverLetter = typeof coverLetters.$inferSelect;
export type NewCoverLetter = typeof coverLetters.$inferInsert;
export type OutreachMessage = typeof outreachMessages.$inferSelect;
export type NewOutreachMessage = typeof outreachMessages.$inferInsert;
export type CoverLetterStatus = (typeof coverLetterStatusEnum.enumValues)[number];
export type TonePreference = (typeof tonePreferenceEnum.enumValues)[number];
export type LengthVariant = (typeof lengthVariantEnum.enumValues)[number];
export type EmphasisPreference = (typeof emphasisPreferenceEnum.enumValues)[number];
export type OutreachPlatform = (typeof outreachPlatformEnum.enumValues)[number];

// Resume Variant enums (UC-6)
export const resumeVariantStatusEnum = pgEnum('resume_variant_status', ['draft', 'finalized']);
export const resumeFormatEnum = pgEnum('resume_format', ['chronological', 'functional', 'hybrid']);
export const sectionEmphasisEnum = pgEnum('section_emphasis', [
  'experience_heavy',
  'skills_heavy',
  'balanced',
]);

export interface SectionBulletSelection {
  sectionId: string;
  bulletIds: string[];
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

export interface VariantRevisionEntry {
  id: string;
  instructions: string;
  previousContent: ResumeContent;
  appliedAt: string;
}

export const resumeVariants = pgTable('resume_variants', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  status: resumeVariantStatusEnum('status').notNull().default('draft'),
  title: text('title').notNull(),
  targetCompany: text('target_company').notNull(),
  targetRole: text('target_role').notNull(),
  format: resumeFormatEnum('format').notNull().default('chronological'),
  sectionEmphasis: sectionEmphasisEnum('section_emphasis').notNull().default('balanced'),
  baseResumeId: text('base_resume_id').references(() => resumes.id, { onDelete: 'set null' }),
  jobFitAnalysisId: text('job_fit_analysis_id'),
  jobDescriptionText: text('job_description_text'),
  jobDescriptionUrl: text('job_description_url'),
  selectedBullets: jsonb('selected_bullets')
    .$type<SectionBulletSelection[]>()
    .notNull()
    .default([]),
  selectedTechTags: jsonb('selected_tech_tags').$type<string[]>().notNull().default([]),
  selectedThemes: jsonb('selected_themes').$type<string[]>().notNull().default([]),
  sectionOrder: jsonb('section_order')
    .$type<string[]>()
    .notNull()
    .default(['summary', 'experience', 'skills', 'projects', 'education']),
  hiddenSections: jsonb('hidden_sections').$type<string[]>().notNull().default([]),
  content: jsonb('content').$type<ResumeContent>().notNull(),
  atsScore: integer('ats_score'),
  revisionHistory: jsonb('revision_history').$type<VariantRevisionEntry[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export type ResumeVariantRow = typeof resumeVariants.$inferSelect;
export type NewResumeVariant = typeof resumeVariants.$inferInsert;
export type ResumeVariantStatus = (typeof resumeVariantStatusEnum.enumValues)[number];
export type ResumeFormat = (typeof resumeFormatEnum.enumValues)[number];
export type SectionEmphasis = (typeof sectionEmphasisEnum.enumValues)[number];

// Interview Prep enums (UC-7)
export const interviewTypeEnum = pgEnum('interview_type', [
  'behavioral',
  'technical',
  'mixed',
  'case_study',
]);

export const prepTimeEnum = pgEnum('prep_time', ['30min', '1hr', '2hr', 'full_day']);

export const confidenceLevelEnum = pgEnum('confidence_level', [
  'not_practiced',
  'needs_work',
  'comfortable',
  'confident',
]);

export const questionCategoryEnum = pgEnum('question_category', [
  'behavioral',
  'technical',
  'situational',
  'role_specific',
  'gap_probing',
]);

export const questionDifficultyEnum = pgEnum('question_difficulty', [
  'standard',
  'challenging',
  'tough',
]);

export const gapSeverityEnum = pgEnum('gap_severity', ['critical', 'moderate', 'minor']);

export const mitigationStrategyEnum = pgEnum('mitigation_strategy', [
  'acknowledge_pivot',
  'growth_mindset',
  'adjacent_experience',
]);

// Interview Prep JSONB types
export interface GeneratedQuestion {
  id: string;
  text: string;
  category: 'behavioral' | 'technical' | 'situational' | 'role_specific' | 'gap_probing';
  difficulty: 'standard' | 'challenging' | 'tough';
  whyTheyAsk: string;
  whatTheyWant: string;
  answerFramework: string;
  suggestedStoryIds: string[];
  linkedStoryId?: string;
  personalNotes?: string;
  practiceStatus: 'not_practiced' | 'needs_work' | 'comfortable' | 'confident';
  lastPracticedAt?: string;
}

export interface TalkingPoint {
  title: string;
  script: string;
  keyPhrases: string[];
  redirectToStrength: string;
}

export interface GapMitigation {
  id: string;
  skill: string;
  severity: 'critical' | 'moderate' | 'minor';
  description: string;
  whyItMatters: string;
  strategies: {
    acknowledgePivot: TalkingPoint;
    growthMindset: TalkingPoint;
    adjacentExperience: TalkingPoint;
  };
  relatedStoryIds: string[];
  selectedStrategy?: 'acknowledge_pivot' | 'growth_mindset' | 'adjacent_experience';
  isAddressed: boolean;
}

export interface SectionConfig {
  id: 'stories' | 'questions' | 'gaps' | 'company';
  enabled: boolean;
  order: number;
  selectedItems: string[];
}

export interface CompanyFact {
  id: string;
  fact: string;
  source: string;
  useFor: 'mention' | 'ask_about';
}

export interface QuickReference {
  sections: SectionConfig[];
  topStoryIds: string[];
  keyQuestionIds: string[];
  gapPointIds: string[];
  companyFacts: CompanyFact[];
  lastExportedAt?: string;
  exportFormat?: 'pdf' | 'markdown' | 'print';
}

export interface PracticeSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  type: 'single_question' | 'full_interview' | 'timed_responses';
  questionsAttempted: number;
  confidenceRatings: {
    needsWork: number;
    comfortable: number;
    confident: number;
  };
  focusAreas?: string[];
}

// Interview Prep tables
export const interviewPreps = pgTable('interview_preps', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' })
    .unique(),
  jobFitAnalysisId: text('job_fit_analysis_id'),
  interviewType: interviewTypeEnum('interview_type').notNull().default('mixed'),
  timeAvailable: prepTimeEnum('time_available').notNull().default('1hr'),
  focusAreas: jsonb('focus_areas').$type<string[]>().notNull().default([]),
  completeness: integer('completeness').notNull().default(0),
  generatedQuestions: jsonb('generated_questions')
    .$type<GeneratedQuestion[]>()
    .notNull()
    .default([]),
  gapMitigations: jsonb('gap_mitigations').$type<GapMitigation[]>().notNull().default([]),
  quickReference: jsonb('quick_reference').$type<QuickReference>(),
  practiceLog: jsonb('practice_log').$type<PracticeSession[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const interviewPrepStories = pgTable('interview_prep_stories', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  interviewPrepId: text('interview_prep_id')
    .notNull()
    .references(() => interviewPreps.id, { onDelete: 'cascade' }),
  starEntryId: text('star_entry_id').notNull(),
  themes: jsonb('themes').$type<string[]>().notNull().default([]),
  relevanceScore: integer('relevance_score').notNull(),
  oneMinVersion: text('one_min_version').notNull(),
  twoMinVersion: text('two_min_version').notNull(),
  fiveMinVersion: text('five_min_version').notNull(),
  isFavorite: boolean('is_favorite').notNull().default(false),
  personalNotes: text('personal_notes'),
  practiceCount: integer('practice_count').notNull().default(0),
  lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),
  confidenceLevel: confidenceLevelEnum('confidence_level').notNull().default('not_practiced'),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prepQuestionStoryLinks = pgTable('prep_question_story_links', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  questionId: text('question_id').notNull(),
  storyId: text('story_id')
    .notNull()
    .references(() => interviewPrepStories.id, { onDelete: 'cascade' }),
  isPrimary: boolean('is_primary').notNull().default(false),
  matchScore: integer('match_score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Interview Prep type exports
export type InterviewPrep = typeof interviewPreps.$inferSelect;
export type NewInterviewPrep = typeof interviewPreps.$inferInsert;
export type InterviewPrepStory = typeof interviewPrepStories.$inferSelect;
export type NewInterviewPrepStory = typeof interviewPrepStories.$inferInsert;
export type PrepQuestionStoryLink = typeof prepQuestionStoryLinks.$inferSelect;
export type NewPrepQuestionStoryLink = typeof prepQuestionStoryLinks.$inferInsert;
export type InterviewType = (typeof interviewTypeEnum.enumValues)[number];
export type PrepTime = (typeof prepTimeEnum.enumValues)[number];
export type ConfidenceLevel = (typeof confidenceLevelEnum.enumValues)[number];

// Personal Info
export const personalInfo = pgTable('personal_info', {
  id: text('id').primaryKey(),
  userId: uuid('user_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country'),
  linkedinUrl: text('linkedin_url'),
  githubUrl: text('github_url'),
  portfolioUrl: text('portfolio_url'),
  websiteUrl: text('website_url'),
  professionalSummary: text('professional_summary'),
  headline: text('headline'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export type PersonalInfo = typeof personalInfo.$inferSelect;
export type NewPersonalInfo = typeof personalInfo.$inferInsert;
