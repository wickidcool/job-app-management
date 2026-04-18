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

## References

- [Architecture Overview](./ARCHITECTURE.md)
- [API Contracts](./API_CONTRACTS.md)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
