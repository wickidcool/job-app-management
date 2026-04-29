# Job Application Manager — Data Model

## Overview

This document defines the PostgreSQL database schema for the Job Application Manager. The relational model naturally supports the application's needs: tracking applications, maintaining status history, and computing dashboard aggregations.

## Database Configuration

**Database**: `job_app_manager`
**Connection**: `postgresql://localhost:5432/job_app_manager`
**ORM**: Drizzle ORM with PostgreSQL driver

## Schema Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           applications                               │
├─────────────────────────────────────────────────────────────────────┤
│ PK │ id              │ TEXT         │ ULID primary key              │
│    │ job_title       │ TEXT         │ NOT NULL                      │
│    │ company         │ TEXT         │ NOT NULL                      │
│    │ url             │ TEXT         │ nullable                      │
│    │ location        │ TEXT         │ nullable                      │
│    │ salary_range    │ TEXT         │ nullable                      │
│    │ status          │ app_status   │ NOT NULL, default 'saved'     │
│ FK │ cover_letter_id │ TEXT         │ nullable, references files    │
│ FK │ resume_id       │ TEXT         │ nullable, references files    │
│    │ applied_at      │ TIMESTAMPTZ  │ nullable                      │
│    │ created_at      │ TIMESTAMPTZ  │ NOT NULL, default now()       │
│    │ updated_at      │ TIMESTAMPTZ  │ NOT NULL, default now()       │
│    │ version         │ INTEGER      │ NOT NULL, default 1           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          status_history                              │
├─────────────────────────────────────────────────────────────────────┤
│ PK │ id              │ TEXT         │ ULID primary key              │
│ FK │ application_id  │ TEXT         │ NOT NULL, references apps     │
│    │ from_status     │ app_status   │ nullable (null for creation)  │
│    │ to_status       │ app_status   │ NOT NULL                      │
│    │ note            │ TEXT         │ nullable                      │
│    │ changed_at      │ TIMESTAMPTZ  │ NOT NULL, default now()       │
└─────────────────────────────────────────────────────────────────────┘
```

## SQL Schema

### Enum Types

```sql
-- Application status enum
CREATE TYPE app_status AS ENUM (
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn'
);
```

### Applications Table

```sql
CREATE TABLE applications (
  id              TEXT PRIMARY KEY,
  job_title       TEXT NOT NULL,
  company         TEXT NOT NULL,
  url             TEXT,
  location        TEXT,
  salary_range    TEXT,
  status          app_status NOT NULL DEFAULT 'saved',
  cover_letter_id TEXT,
  resume_id       TEXT,
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version         INTEGER NOT NULL DEFAULT 1
);

-- Indexes for common queries
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_company ON applications(company);
CREATE INDEX idx_applications_created_at ON applications(created_at DESC);
CREATE INDEX idx_applications_updated_at ON applications(updated_at DESC);
```

### Status History Table

```sql
CREATE TABLE status_history (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status     app_status,
  to_status       app_status NOT NULL,
  note            TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching history by application
CREATE INDEX idx_status_history_application ON status_history(application_id, changed_at DESC);
```

### Updated At Trigger

```sql
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

## Drizzle ORM Schema

```typescript
// backend/src/db/schema.ts

import { pgTable, text, timestamp, integer, pgEnum } from 'drizzle-orm/pg-core';

// Enum for application status
export const appStatusEnum = pgEnum('app_status', [
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
]);

// Applications table
export const applications = pgTable('applications', {
  id: text('id').primaryKey(),
  jobTitle: text('job_title').notNull(),
  company: text('company').notNull(),
  url: text('url'),
  location: text('location'),
  salaryRange: text('salary_range'),
  status: appStatusEnum('status').notNull().default('saved'),
  coverLetterId: text('cover_letter_id'),
  resumeId: text('resume_id'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

// Status history table
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

// Type exports
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type StatusHistoryEntry = typeof statusHistory.$inferSelect;
export type NewStatusHistoryEntry = typeof statusHistory.$inferInsert;
export type ApplicationStatus = (typeof appStatusEnum.enumValues)[number];
```

## TypeScript Types

```typescript
// backend/src/types/index.ts

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export interface Application {
  id: string;
  jobTitle: string;
  company: string;
  url: string | null;
  location: string | null;
  salaryRange: string | null;
  status: ApplicationStatus;
  coverLetterId: string | null;
  resumeId: string | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface StatusHistoryEntry {
  id: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note: string | null;
  changedAt: Date;
}

export interface DashboardStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  appliedThisWeek: number;
  appliedThisMonth: number;
  responseRate: number;
}
```

## Status Transition Rules

Valid transitions are enforced in the application layer:

```typescript
// backend/src/services/status.service.ts

const VALID_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  saved: ['applied', 'withdrawn'],
  applied: ['phone_screen', 'rejected', 'withdrawn'],
  phone_screen: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: [],        // Terminal state
  rejected: [],     // Terminal state
  withdrawn: [],    // Terminal state
};

export function isValidTransition(
  from: ApplicationStatus,
  to: ApplicationStatus
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function getValidNextStatuses(current: ApplicationStatus): ApplicationStatus[] {
  return VALID_TRANSITIONS[current];
}
```

## Common Queries

### List Applications with Filtering

```typescript
import { eq, desc, ilike, inArray, and } from 'drizzle-orm';

// List with optional filters
async function listApplications(filters?: {
  status?: ApplicationStatus[];
  company?: string;
  search?: string;
}) {
  const conditions = [];
  
  if (filters?.status?.length) {
    conditions.push(inArray(applications.status, filters.status));
  }
  
  if (filters?.company) {
    conditions.push(ilike(applications.company, `%${filters.company}%`));
  }
  
  if (filters?.search) {
    conditions.push(
      or(
        ilike(applications.jobTitle, `%${filters.search}%`),
        ilike(applications.company, `%${filters.search}%`)
      )
    );
  }
  
  return db
    .select()
    .from(applications)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(applications.updatedAt));
}
```

### Get Application with History

```typescript
async function getApplicationWithHistory(id: string) {
  const [app] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id));
  
  if (!app) return null;
  
  const history = await db
    .select()
    .from(statusHistory)
    .where(eq(statusHistory.applicationId, id))
    .orderBy(desc(statusHistory.changedAt));
  
  return { application: app, statusHistory: history };
}
```

### Dashboard Aggregations

```typescript
import { sql, count } from 'drizzle-orm';

async function getDashboardStats(): Promise<DashboardStats> {
  // Count by status
  const statusCounts = await db
    .select({
      status: applications.status,
      count: count(),
    })
    .from(applications)
    .groupBy(applications.status);
  
  // Applied this week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const [weekStats] = await db
    .select({ count: count() })
    .from(applications)
    .where(
      and(
        eq(applications.status, 'applied'),
        gte(applications.appliedAt, oneWeekAgo)
      )
    );
  
  // Build response
  const byStatus = Object.fromEntries(
    statusCounts.map(({ status, count }) => [status, count])
  ) as Record<ApplicationStatus, number>;
  
  const total = statusCounts.reduce((sum, { count }) => sum + count, 0);
  const applied = byStatus.applied || 0;
  const responded = (byStatus.phone_screen || 0) + 
                    (byStatus.interview || 0) + 
                    (byStatus.offer || 0) + 
                    (byStatus.rejected || 0);
  
  return {
    total,
    byStatus,
    appliedThisWeek: weekStats?.count || 0,
    appliedThisMonth: 0, // Similar query for month
    responseRate: applied > 0 ? responded / applied : 0,
  };
}
```

## Transactions

### Create Application with Initial History

```typescript
import { ulid } from 'ulid';

async function createApplication(data: CreateApplicationInput) {
  const id = ulid();
  const historyId = ulid();
  const now = new Date();
  
  return db.transaction(async (tx) => {
    // Insert application
    const [app] = await tx
      .insert(applications)
      .values({
        id,
        jobTitle: data.jobTitle,
        company: data.company,
        url: data.url,
        location: data.location,
        salaryRange: data.salaryRange,
        status: data.status || 'saved',
        coverLetterId: data.coverLetterId,
        resumeId: data.resumeId,
        appliedAt: data.status === 'applied' ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    
    // Insert initial history entry
    await tx.insert(statusHistory).values({
      id: historyId,
      applicationId: id,
      fromStatus: null,
      toStatus: app.status,
      changedAt: now,
    });
    
    return app;
  });
}
```

### Update Status with History

```typescript
async function updateStatus(
  id: string,
  newStatus: ApplicationStatus,
  note?: string,
  expectedVersion?: number
) {
  return db.transaction(async (tx) => {
    // Get current application with lock
    const [current] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .for('update');
    
    if (!current) {
      throw new Error('Application not found');
    }
    
    // Optimistic locking check
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new Error('Version conflict - application was modified');
    }
    
    // Validate transition
    if (!isValidTransition(current.status, newStatus)) {
      throw new Error(
        `Invalid transition from '${current.status}' to '${newStatus}'`
      );
    }
    
    const now = new Date();
    
    // Update application
    const [updated] = await tx
      .update(applications)
      .set({
        status: newStatus,
        appliedAt: newStatus === 'applied' && !current.appliedAt ? now : current.appliedAt,
        updatedAt: now,
        version: current.version + 1,
      })
      .where(eq(applications.id, id))
      .returning();
    
    // Insert history entry
    await tx.insert(statusHistory).values({
      id: ulid(),
      applicationId: id,
      fromStatus: current.status,
      toStatus: newStatus,
      note,
      changedAt: now,
    });
    
    return updated;
  });
}
```

## Migrations

### Migration Files

```
backend/src/db/migrations/
├── 0001_create_app_status_enum.sql
├── 0002_create_applications_table.sql
├── 0003_create_status_history_table.sql
└── 0004_create_indexes.sql
```

### Running Migrations

```bash
# Generate migration from schema changes
pnpm drizzle-kit generate:pg

# Apply migrations
pnpm drizzle-kit push:pg

# Or with custom script
pnpm db:migrate
```

### Drizzle Config

```typescript
// drizzle.config.ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

## Backup & Restore

### Backup

```bash
# Full database backup
pg_dump -h localhost -U postgres job_app_manager > backup.sql

# Compressed backup
pg_dump -h localhost -U postgres job_app_manager | gzip > backup.sql.gz

# Specific tables only
pg_dump -h localhost -U postgres -t applications -t status_history job_app_manager > apps_backup.sql
```

### Restore

```bash
# Restore from backup
psql -h localhost -U postgres job_app_manager < backup.sql

# Restore compressed
gunzip -c backup.sql.gz | psql -h localhost -U postgres job_app_manager
```

---

## Catalog Tables (UC-2 Master Catalog Index)

The catalog subsystem stores a normalized, queryable knowledge base of professional attributes extracted from resumes and applications via the diff review workflow.

### Schema Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  company_catalog│     │  tech_stack_tags  │     │   job_fit_tags   │
├─────────────────┤     ├──────────────────┤     ├──────────────────┤
│ id (PK)         │     │ id (PK)          │     │ id (PK)          │
│ name            │     │ tag_slug (UNIQUE) │     │ tag_slug (UNIQUE)│
│ normalized_name │     │ display_name     │     │ display_name     │
│ aliases (JSONB) │     │ category (ENUM)  │     │ category (ENUM)  │
│ first_seen_at   │     │ aliases (JSONB)  │     │ aliases (JSONB)  │
│ application_count│    │ mention_count    │     │ mention_count    │
│ latest_status   │     │ needs_review     │     │ needs_review     │
│ is_deleted      │     │ review_options   │     │ review_options   │
│ version         │     │ version          │     │ version          │
└─────────────────┘     └──────────────────┘     └──────────────────┘

┌──────────────────────┐     ┌──────────────────┐
│  quantified_bullets  │     │ recurring_themes  │
├──────────────────────┤     ├──────────────────┤
│ id (PK)              │     │ id (PK)          │
│ source_type          │     │ theme_slug       │
│ source_id (indexed)  │     │ display_name     │
│ raw_text             │     │ occurrence_count │
│ action_verb          │     │ source_ids (JSONB│
│ metric_type (ENUM)   │     │ example_excerpts │
│ metric_value         │     │ is_core_strength │
│ is_approximate       │     │ is_historical    │
│ impact_category (ENUM│     │ last_seen_at     │
│ extracted_at         │     │ version          │
│ version              │     └──────────────────┘
└──────────────────────┘

┌──────────────────────┐     ┌──────────────────────┐
│  catalog_diffs       │     │ catalog_change_log   │
├──────────────────────┤     ├──────────────────────┤
│ id (PK)              │     │ id (PK)              │
│ trigger_source       │     │ entity_type          │
│ trigger_id           │     │ entity_id (indexed)  │
│ summary              │     │ action (ENUM)        │
│ changes (JSONB)      │     │ before_state (JSONB) │
│ pending_review (JSONB│     │ after_state (JSONB)  │
│ status (ENUM)        │     │ trigger_source       │
│ user_decisions (JSONB│     │ trigger_id           │
│ expires_at           │     │ diff_id (indexed)    │
│ resolved_at          │     │ committed            │
└──────────────────────┘     │ committed_at         │
                             └──────────────────────┘

┌──────────────────────┐
│  wikilink_registry   │
├──────────────────────┤
│ id (PK)              │
│ link_text            │
│ normalized_text      │
│ target_type          │
│ target_id            │
│ is_manual (boolean)  │
│ created_at           │
└──────────────────────┘
```

### Enum Types (Catalog)

```sql
-- Tag categories
CREATE TYPE job_fit_category AS ENUM (
  'role', 'industry', 'seniority', 'work_style', 'uncategorized'
);

CREATE TYPE tech_stack_category AS ENUM (
  'language', 'frontend', 'backend', 'database',
  'cloud', 'devops', 'ai_ml', 'uncategorized'
);

-- Metric types for quantified bullets
CREATE TYPE metric_type AS ENUM (
  'percentage', 'currency', 'count', 'time', 'multiplier'
);

-- Impact categories for quantified bullets
CREATE TYPE impact_category AS ENUM (
  'revenue', 'cost_savings', 'efficiency', 'team_leadership',
  'user_growth', 'performance', 'other'
);

-- Change log action
CREATE TYPE change_action AS ENUM ('create', 'update', 'delete', 'merge');

-- Diff lifecycle status
CREATE TYPE diff_status AS ENUM (
  'pending', 'approved', 'rejected', 'partial', 'expired'
);
```

### Catalog Tables

```sql
-- Normalized company entries
CREATE TABLE company_catalog (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  normalized_name   TEXT NOT NULL UNIQUE,
  aliases           JSONB NOT NULL DEFAULT '[]',
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  application_count INTEGER NOT NULL DEFAULT 0,
  latest_status     app_status,
  latest_app_id     TEXT REFERENCES applications(id) ON DELETE SET NULL,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_company_catalog_normalized ON company_catalog(normalized_name);
CREATE INDEX idx_company_catalog_deleted ON company_catalog(is_deleted);

-- Tech stack tags (frameworks, languages, tools)
CREATE TABLE tech_stack_tags (
  id               TEXT PRIMARY KEY,
  tag_slug         TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  category         tech_stack_category NOT NULL DEFAULT 'uncategorized',
  aliases          JSONB NOT NULL DEFAULT '[]',
  source_ids       JSONB NOT NULL DEFAULT '[]',
  mention_count    INTEGER NOT NULL DEFAULT 0,
  version_mentioned TEXT,
  is_legacy        BOOLEAN NOT NULL DEFAULT FALSE,
  needs_review     BOOLEAN NOT NULL DEFAULT FALSE,
  review_options   JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tech_stack_tags_category ON tech_stack_tags(category);
CREATE INDEX idx_tech_stack_tags_needs_review ON tech_stack_tags(needs_review);

-- Job fit tags (roles, industries, seniority signals)
CREATE TABLE job_fit_tags (
  id             TEXT PRIMARY KEY,
  tag_slug       TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  category       job_fit_category NOT NULL DEFAULT 'uncategorized',
  aliases        JSONB NOT NULL DEFAULT '[]',
  source_ids     JSONB NOT NULL DEFAULT '[]',
  mention_count  INTEGER NOT NULL DEFAULT 0,
  needs_review   BOOLEAN NOT NULL DEFAULT FALSE,
  review_options JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_job_fit_tags_category ON job_fit_tags(category);
CREATE INDEX idx_job_fit_tags_needs_review ON job_fit_tags(needs_review);

-- Extracted metric achievements from resume bullets
CREATE TABLE quantified_bullets (
  id                      TEXT PRIMARY KEY,
  source_type             TEXT NOT NULL,   -- 'resume' | 'application'
  source_id               TEXT NOT NULL,
  raw_text                TEXT NOT NULL,
  action_verb             TEXT,
  metric_type             metric_type,
  metric_value            NUMERIC,
  metric_range            JSONB,
  is_approximate          BOOLEAN NOT NULL DEFAULT FALSE,
  secondary_metric_type   TEXT,
  secondary_metric_value  NUMERIC,
  impact_category         impact_category NOT NULL DEFAULT 'other',
  extracted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version                 INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_quantified_bullets_source ON quantified_bullets(source_type, source_id);
CREATE INDEX idx_quantified_bullets_impact ON quantified_bullets(impact_category);

-- Recurring professional themes
CREATE TABLE recurring_themes (
  id               TEXT PRIMARY KEY,
  theme_slug       TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  aliases          JSONB NOT NULL DEFAULT '[]',
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  source_ids       JSONB NOT NULL DEFAULT '[]',
  example_excerpts JSONB NOT NULL DEFAULT '[]',
  is_core_strength BOOLEAN NOT NULL DEFAULT FALSE,  -- true when occurrence_count >= 3
  is_historical    BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_recurring_themes_core ON recurring_themes(is_core_strength);

-- Pending change diffs awaiting user review
CREATE TABLE catalog_diffs (
  id               TEXT PRIMARY KEY,
  trigger_source   TEXT NOT NULL,  -- 'resume_upload' | 'application_update'
  trigger_id       TEXT NOT NULL,
  summary          TEXT NOT NULL,
  changes          JSONB NOT NULL DEFAULT '[]',
  pending_review   JSONB NOT NULL DEFAULT '[]',
  status           diff_status NOT NULL DEFAULT 'pending',
  user_decisions   JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,   -- created_at + 7 days
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX idx_catalog_diffs_trigger ON catalog_diffs(trigger_source, trigger_id);
CREATE INDEX idx_catalog_diffs_status ON catalog_diffs(status);

-- Immutable audit trail of all catalog mutations
CREATE TABLE catalog_change_log (
  id             TEXT PRIMARY KEY,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  action         change_action NOT NULL,
  before_state   JSONB,
  after_state    JSONB,
  trigger_source TEXT NOT NULL,
  trigger_id     TEXT NOT NULL,
  diff_id        TEXT,
  committed      BOOLEAN NOT NULL DEFAULT FALSE,
  committed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalog_change_log_entity ON catalog_change_log(entity_type, entity_id);
CREATE INDEX idx_catalog_change_log_diff ON catalog_change_log(diff_id);

-- Maps [[wikilink]] text to resolved catalog entities
CREATE TABLE wikilink_registry (
  id              TEXT PRIMARY KEY,
  link_text       TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  target_type     TEXT NOT NULL,  -- 'company' | 'tag' | 'theme'
  target_id       TEXT NOT NULL,
  is_manual       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (normalized_text, target_type)
);

CREATE INDEX idx_wikilink_registry_normalized ON wikilink_registry(normalized_text);
```

### Wikilink Resolution

The extraction service scans source text for `[[wikilink]]` patterns and resolves them against the catalog:

1. Matches are found with the regex `/\[\[([^\]]+)\]\]/g`
2. Unresolved matches become `ReviewItem` entries with `type: 'unresolved_wikilink'`
3. When the user resolves a wikilink during diff review, the mapping is stored in `wikilink_registry`
4. Subsequent extractions use `wikilink_registry` for automatic resolution via `normalized_text` fuzzy lookup

### Core Strength Promotion

`recurring_themes.is_core_strength` is automatically set to `true` when a theme's `occurrence_count` reaches 3. The extraction service rechecks this threshold on every `UPDATE` to `occurrence_count`.

### Diff Expiry

Diffs expire 7 days after creation (`expires_at = created_at + INTERVAL '7 days'`). Expired diffs have their `status` updated to `expired` by a scheduled cleanup job and can no longer be applied.

---

## Resume Variants (UC-6)

Resume variants are tailored resume versions generated for specific job applications.

### Schema Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          resume_variants                              │
├──────────────────────────────────────────────────────────────────────┤
│ PK │ id                    │ TEXT              │ ULID primary key    │
│    │ status                │ resume_variant_status │ draft/finalized │
│    │ title                 │ TEXT              │ NOT NULL            │
│    │ target_company        │ TEXT              │ NOT NULL            │
│    │ target_role           │ TEXT              │ NOT NULL            │
│    │ format                │ resume_format     │ chronological/etc   │
│    │ section_emphasis      │ section_emphasis  │ balanced/etc        │
│ FK │ base_resume_id        │ TEXT              │ references resumes  │
│    │ job_fit_analysis_id   │ TEXT              │ nullable            │
│    │ selected_bullets      │ JSONB             │ bullet selections   │
│    │ selected_tech_tags    │ JSONB             │ tag IDs array       │
│    │ selected_themes       │ JSONB             │ theme slugs array   │
│    │ section_order         │ JSONB             │ section ordering    │
│    │ hidden_sections       │ JSONB             │ sections to hide    │
│    │ content               │ JSONB             │ structured content  │
│    │ revision_history      │ JSONB             │ revision entries    │
│    │ created_at            │ TIMESTAMPTZ       │ NOT NULL            │
│    │ updated_at            │ TIMESTAMPTZ       │ NOT NULL            │
│    │ version               │ INTEGER           │ optimistic locking  │
└──────────────────────────────────────────────────────────────────────┘
```

See [UC-6 Resume Variant Generation API](./UC-6_RESUME_VARIANT_API.md) for full schema and endpoint documentation.

---

## Interview Prep (UC-7)

Interview prep records store generated preparation materials for upcoming interviews, including categorized STAR stories, anticipated questions, gap mitigation strategies, and quick reference exports.

### Schema Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            interview_preps                                │
├──────────────────────────────────────────────────────────────────────────┤
│ PK │ id                      │ TEXT              │ ULID primary key      │
│ FK │ application_id          │ TEXT              │ NOT NULL, references  │
│ FK │ job_fit_analysis_id     │ TEXT              │ nullable              │
│    │ interview_type          │ interview_type    │ behavioral/technical  │
│    │ time_available          │ prep_time         │ 30min/1hr/2hr/full    │
│    │ focus_areas             │ JSONB             │ theme slugs array     │
│    │ completeness            │ INTEGER           │ 0-100 percentage      │
│    │ story_selections        │ JSONB             │ story IDs + metadata  │
│    │ generated_questions     │ JSONB             │ anticipated questions │
│    │ gap_mitigations         │ JSONB             │ talking points        │
│    │ quick_reference         │ JSONB             │ export configuration  │
│    │ practice_log            │ JSONB             │ practice history      │
│    │ created_at              │ TIMESTAMPTZ       │ NOT NULL              │
│    │ updated_at              │ TIMESTAMPTZ       │ NOT NULL              │
│    │ version                 │ INTEGER           │ optimistic locking    │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         interview_prep_stories                            │
├──────────────────────────────────────────────────────────────────────────┤
│ PK │ id                      │ TEXT              │ ULID primary key      │
│ FK │ interview_prep_id       │ TEXT              │ NOT NULL, references  │
│ FK │ star_entry_id           │ TEXT              │ NOT NULL, catalog ref │
│    │ themes                  │ JSONB             │ classified themes     │
│    │ relevance_score         │ INTEGER           │ 0-100 from analysis   │
│    │ one_min_version         │ TEXT              │ time-boxed summary    │
│    │ two_min_version         │ TEXT              │ time-boxed summary    │
│    │ five_min_version        │ TEXT              │ full story version    │
│    │ is_favorite             │ BOOLEAN           │ user-marked favorite  │
│    │ personal_notes          │ TEXT              │ user notes            │
│    │ practice_count          │ INTEGER           │ times practiced       │
│    │ last_practiced_at       │ TIMESTAMPTZ       │ last practice date    │
│    │ confidence_level        │ confidence_level  │ not/needs/ok/great    │
│    │ display_order           │ INTEGER           │ sort order in theme   │
│    │ created_at              │ TIMESTAMPTZ       │ NOT NULL              │
│    │ updated_at              │ TIMESTAMPTZ       │ NOT NULL              │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ M:N (via junction)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       prep_question_story_links                           │
├──────────────────────────────────────────────────────────────────────────┤
│ PK │ id                      │ TEXT              │ ULID primary key      │
│ FK │ question_id             │ TEXT              │ NOT NULL              │
│ FK │ story_id                │ TEXT              │ NOT NULL              │
│    │ is_primary              │ BOOLEAN           │ primary answer choice │
│    │ match_score             │ INTEGER           │ relevance to question │
│    │ created_at              │ TIMESTAMPTZ       │ NOT NULL              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Enum Types (Interview Prep)

```sql
-- Interview type
CREATE TYPE interview_type AS ENUM (
  'behavioral',
  'technical',
  'mixed',
  'case_study'
);

-- Prep time allocation
CREATE TYPE prep_time AS ENUM (
  '30min',
  '1hr',
  '2hr',
  'full_day'
);

-- Question categories
CREATE TYPE question_category AS ENUM (
  'behavioral',
  'technical',
  'situational',
  'role_specific',
  'gap_probing'
);

-- Question difficulty
CREATE TYPE question_difficulty AS ENUM (
  'standard',
  'challenging',
  'tough'
);

-- Confidence level after practice
CREATE TYPE confidence_level AS ENUM (
  'not_practiced',
  'needs_work',
  'comfortable',
  'confident'
);

-- Gap severity (mirrors job fit analysis)
CREATE TYPE gap_severity AS ENUM (
  'critical',
  'moderate',
  'minor'
);

-- Mitigation strategy types
CREATE TYPE mitigation_strategy AS ENUM (
  'acknowledge_pivot',
  'growth_mindset',
  'adjacent_experience'
);
```

### Interview Prep Table

```sql
CREATE TABLE interview_preps (
  id                    TEXT PRIMARY KEY,
  application_id        TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_fit_analysis_id   TEXT REFERENCES job_fit_analyses(id) ON DELETE SET NULL,
  interview_type        interview_type NOT NULL DEFAULT 'mixed',
  time_available        prep_time NOT NULL DEFAULT '1hr',
  focus_areas           JSONB NOT NULL DEFAULT '[]',
  completeness          INTEGER NOT NULL DEFAULT 0 CHECK (completeness >= 0 AND completeness <= 100),
  story_selections      JSONB NOT NULL DEFAULT '{}',
  generated_questions   JSONB NOT NULL DEFAULT '[]',
  gap_mitigations       JSONB NOT NULL DEFAULT '[]',
  quick_reference       JSONB,
  practice_log          JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1,
  
  UNIQUE(application_id)  -- One prep per application
);

CREATE INDEX idx_interview_preps_application ON interview_preps(application_id);
CREATE INDEX idx_interview_preps_created_at ON interview_preps(created_at DESC);
```

### Interview Prep Stories (STAR Entries with Time-Boxed Versions)

```sql
CREATE TABLE interview_prep_stories (
  id                    TEXT PRIMARY KEY,
  interview_prep_id     TEXT NOT NULL REFERENCES interview_preps(id) ON DELETE CASCADE,
  star_entry_id         TEXT NOT NULL,  -- References catalog quantified_bullets or STAR entries
  themes                JSONB NOT NULL DEFAULT '[]',
  relevance_score       INTEGER NOT NULL CHECK (relevance_score >= 0 AND relevance_score <= 100),
  one_min_version       TEXT NOT NULL,
  two_min_version       TEXT NOT NULL,
  five_min_version      TEXT NOT NULL,
  is_favorite           BOOLEAN NOT NULL DEFAULT FALSE,
  personal_notes        TEXT,
  practice_count        INTEGER NOT NULL DEFAULT 0,
  last_practiced_at     TIMESTAMPTZ,
  confidence_level      confidence_level NOT NULL DEFAULT 'not_practiced',
  display_order         INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prep_stories_prep ON interview_prep_stories(interview_prep_id);
CREATE INDEX idx_prep_stories_favorite ON interview_prep_stories(interview_prep_id, is_favorite);
CREATE INDEX idx_prep_stories_theme ON interview_prep_stories USING GIN (themes);
```

### JSONB Field Schemas

**generated_questions** — Array of anticipated interview questions:

```typescript
interface GeneratedQuestion {
  id: string;
  text: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  whyTheyAsk: string;
  whatTheyWant: string;
  answerFramework: string;
  suggestedStoryIds: string[];
  linkedStoryId?: string;
  personalNotes?: string;
  practiceStatus: ConfidenceLevel;
  lastPracticedAt?: string; // ISO timestamp
}
```

**gap_mitigations** — Array of gap talking points:

```typescript
interface GapMitigation {
  id: string;
  skill: string;
  severity: GapSeverity;
  description: string;
  whyItMatters: string;
  strategies: {
    acknowledgePivot: TalkingPoint;
    growthMindset: TalkingPoint;
    adjacentExperience: TalkingPoint;
  };
  relatedStoryIds: string[];
  selectedStrategy?: MitigationStrategy;
  isAddressed: boolean;
}

interface TalkingPoint {
  title: string;
  script: string;
  keyPhrases: string[];
  redirectToStrength: string;
}
```

**quick_reference** — Export configuration and cached content:

```typescript
interface QuickReference {
  sections: SectionConfig[];
  topStoryIds: string[];
  keyQuestionIds: string[];
  gapPointIds: string[];
  companyFacts: CompanyFact[];
  lastExportedAt?: string;
  exportFormat?: 'pdf' | 'markdown' | 'print';
}

interface SectionConfig {
  id: 'stories' | 'questions' | 'gaps' | 'company';
  enabled: boolean;
  order: number;
  selectedItems: string[];
}

interface CompanyFact {
  id: string;
  fact: string;
  source: string;
  useFor: 'mention' | 'ask_about';
}
```

**practice_log** — Practice session history:

```typescript
interface PracticeSession {
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
```

### Relationships to Other Tables

| Source Table | Target Table | Relationship | Notes |
|--------------|--------------|--------------|-------|
| `interview_preps` | `applications` | N:1 | One prep per application (UNIQUE constraint) |
| `interview_preps` | `job_fit_analyses` | N:1 (optional) | Uses fit analysis for gap mitigations |
| `interview_prep_stories` | `interview_preps` | N:1 | Stories belong to a prep |
| `interview_prep_stories` | `quantified_bullets` | N:1 | References catalog STAR entries |
| `prep_question_story_links` | `interview_prep_stories` | N:1 | Links questions to suggested stories |

### Completeness Calculation

The `completeness` field is computed based on four weighted factors:

```typescript
function calculateCompleteness(prep: InterviewPrep): number {
  const weights = {
    hasStories: 25,      // At least 5 stories with time-boxed versions
    hasQuestions: 25,    // At least 5 questions with linked STAR stories
    hasGapPrep: 25,      // All gaps have talking points prepared
    hasQuickRef: 25      // Quick reference card generated
  };
  
  let score = 0;
  
  // Stories: 5+ stories = full points, proportional below
  const storyCount = prep.storySelections.length;
  score += Math.min(storyCount / 5, 1) * weights.hasStories;
  
  // Questions: 5+ linked questions = full points
  const linkedQuestions = prep.generatedQuestions.filter(q => q.linkedStoryId);
  score += Math.min(linkedQuestions.length / 5, 1) * weights.hasQuestions;
  
  // Gaps: all gaps addressed = full points
  const totalGaps = prep.gapMitigations.length;
  const addressedGaps = prep.gapMitigations.filter(g => g.isAddressed).length;
  score += totalGaps > 0 ? (addressedGaps / totalGaps) * weights.hasGapPrep : weights.hasGapPrep;
  
  // Quick ref: generated = full points
  score += prep.quickReference?.lastExportedAt ? weights.hasQuickRef : 0;
  
  return Math.round(score);
}
```

### Theme Classification

STAR entries are classified into themes during prep generation using keyword matching and ML classification:

| Theme | Detection Keywords | Weight in Matching |
|-------|-------------------|-------------------|
| `leadership` | led, managed, directed, mentored, coached, team of, supervised | High |
| `technical` | built, implemented, architected, designed, coded, debugged, optimized | High |
| `teamwork` | collaborated, cross-functional, partnered, worked with, alongside | Medium |
| `problem_solving` | solved, fixed, diagnosed, resolved, overcame, addressed | Medium |
| `communication` | presented, negotiated, documented, communicated, convinced | Medium |
| `innovation` | created, invented, pioneered, transformed, first to, introduced | High |

### Drizzle ORM Schema

```typescript
// packages/api/src/db/schema.ts (additions)

import { pgEnum } from 'drizzle-orm/pg-core';

export const interviewTypeEnum = pgEnum('interview_type', [
  'behavioral', 'technical', 'mixed', 'case_study'
]);

export const prepTimeEnum = pgEnum('prep_time', [
  '30min', '1hr', '2hr', 'full_day'
]);

export const confidenceLevelEnum = pgEnum('confidence_level', [
  'not_practiced', 'needs_work', 'comfortable', 'confident'
]);

export const interviewPreps = pgTable('interview_preps', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' })
    .unique(),
  jobFitAnalysisId: text('job_fit_analysis_id'),
  interviewType: interviewTypeEnum('interview_type').notNull().default('mixed'),
  timeAvailable: prepTimeEnum('time_available').notNull().default('1hr'),
  focusAreas: jsonb('focus_areas').notNull().default([]),
  completeness: integer('completeness').notNull().default(0),
  storySelections: jsonb('story_selections').notNull().default({}),
  generatedQuestions: jsonb('generated_questions').notNull().default([]),
  gapMitigations: jsonb('gap_mitigations').notNull().default([]),
  quickReference: jsonb('quick_reference'),
  practiceLog: jsonb('practice_log').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const interviewPrepStories = pgTable('interview_prep_stories', {
  id: text('id').primaryKey(),
  interviewPrepId: text('interview_prep_id')
    .notNull()
    .references(() => interviewPreps.id, { onDelete: 'cascade' }),
  starEntryId: text('star_entry_id').notNull(),
  themes: jsonb('themes').notNull().default([]),
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

// Type exports
export type InterviewPrep = typeof interviewPreps.$inferSelect;
export type NewInterviewPrep = typeof interviewPreps.$inferInsert;
export type InterviewPrepStory = typeof interviewPrepStories.$inferSelect;
export type NewInterviewPrepStory = typeof interviewPrepStories.$inferInsert;
```

### Migration File

```sql
-- migrations/0010_create_interview_prep_tables.sql

-- Enum types
CREATE TYPE interview_type AS ENUM ('behavioral', 'technical', 'mixed', 'case_study');
CREATE TYPE prep_time AS ENUM ('30min', '1hr', '2hr', 'full_day');
CREATE TYPE confidence_level AS ENUM ('not_practiced', 'needs_work', 'comfortable', 'confident');

-- Main interview prep table
CREATE TABLE interview_preps (
  id                    TEXT PRIMARY KEY,
  application_id        TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE UNIQUE,
  job_fit_analysis_id   TEXT,
  interview_type        interview_type NOT NULL DEFAULT 'mixed',
  time_available        prep_time NOT NULL DEFAULT '1hr',
  focus_areas           JSONB NOT NULL DEFAULT '[]',
  completeness          INTEGER NOT NULL DEFAULT 0 CHECK (completeness >= 0 AND completeness <= 100),
  story_selections      JSONB NOT NULL DEFAULT '{}',
  generated_questions   JSONB NOT NULL DEFAULT '[]',
  gap_mitigations       JSONB NOT NULL DEFAULT '[]',
  quick_reference       JSONB,
  practice_log          JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_interview_preps_application ON interview_preps(application_id);
CREATE INDEX idx_interview_preps_created_at ON interview_preps(created_at DESC);

-- Prep stories with time-boxed versions
CREATE TABLE interview_prep_stories (
  id                    TEXT PRIMARY KEY,
  interview_prep_id     TEXT NOT NULL REFERENCES interview_preps(id) ON DELETE CASCADE,
  star_entry_id         TEXT NOT NULL,
  themes                JSONB NOT NULL DEFAULT '[]',
  relevance_score       INTEGER NOT NULL CHECK (relevance_score >= 0 AND relevance_score <= 100),
  one_min_version       TEXT NOT NULL,
  two_min_version       TEXT NOT NULL,
  five_min_version      TEXT NOT NULL,
  is_favorite           BOOLEAN NOT NULL DEFAULT FALSE,
  personal_notes        TEXT,
  practice_count        INTEGER NOT NULL DEFAULT 0,
  last_practiced_at     TIMESTAMPTZ,
  confidence_level      confidence_level NOT NULL DEFAULT 'not_practiced',
  display_order         INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prep_stories_prep ON interview_prep_stories(interview_prep_id);
CREATE INDEX idx_prep_stories_favorite ON interview_prep_stories(interview_prep_id, is_favorite);
CREATE INDEX idx_prep_stories_theme ON interview_prep_stories USING GIN (themes);

-- Trigger for updated_at
CREATE TRIGGER interview_preps_updated_at
  BEFORE UPDATE ON interview_preps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER interview_prep_stories_updated_at
  BEFORE UPDATE ON interview_prep_stories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

---

## References

- [Architecture Overview](./ARCHITECTURE.md)
- [API Contracts](./API_CONTRACTS.md)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
