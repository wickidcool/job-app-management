# Job Application Manager — Data Model

## Overview

This document defines the DynamoDB single-table design for the Job Application Manager. Single-table design optimizes for the application's access patterns while minimizing the number of queries needed.

## Table Definition

**Table Name**: `JobApplicationManager-Applications`

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | String | Partition key |
| `SK` | String | Sort key |
| `GSI1PK` | String | GSI1 partition key |
| `GSI1SK` | String | GSI1 sort key |
| `entityType` | String | Entity discriminator |
| `data` | Map | Entity-specific attributes |

### Global Secondary Index

**GSI1**: Enables queries by status and date range

| Attribute | Key Type |
|-----------|----------|
| `GSI1PK` | Partition Key |
| `GSI1SK` | Sort Key |

## Entity Definitions

### Application Entity

Primary entity for tracking job applications.

**Key Pattern**:
- `PK`: `USER#{userId}`
- `SK`: `APP#{applicationId}`
- `GSI1PK`: `USER#{userId}#STATUS#{status}`
- `GSI1SK`: `{updatedAt}` (ISO 8601)

**Attributes**:

```typescript
interface ApplicationEntity {
  // Keys
  PK: `USER#${string}`;
  SK: `APP#${string}`;
  GSI1PK: `USER#${string}#STATUS#${ApplicationStatus}`;
  GSI1SK: string; // ISO 8601 timestamp
  
  // Metadata
  entityType: 'APPLICATION';
  
  // Core fields
  id: string;                    // ULID
  userId: string;                // From Cognito sub claim
  jobTitle: string;              // Required
  company: string;               // Required
  url?: string;                  // Job posting URL
  location?: string;             // Remote, City, etc.
  salaryRange?: string;          // "$80k-100k", etc.
  status: ApplicationStatus;
  
  // Linked documents
  coverLetterId?: string;        // Reference to cover letter
  resumeVersionId?: string;      // Reference to resume version
  
  // Timestamps
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  appliedAt?: string;            // ISO 8601, when status → applied
  
  // Version for optimistic locking
  version: number;
}

type ApplicationStatus = 
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';
```

**Example Item**:

```json
{
  "PK": "USER#550e8400-e29b-41d4-a716-446655440000",
  "SK": "APP#01HXK5R3J7Q8N2M4P6W9Y1Z3A5",
  "GSI1PK": "USER#550e8400-e29b-41d4-a716-446655440000#STATUS#applied",
  "GSI1SK": "2026-04-15T10:30:00.000Z",
  "entityType": "APPLICATION",
  "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3A5",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "jobTitle": "Senior Software Engineer",
  "company": "Acme Corp",
  "url": "https://acme.com/careers/senior-swe",
  "location": "Remote (US)",
  "salaryRange": "$150k-180k",
  "status": "applied",
  "coverLetterId": "01HXK5R3J7Q8N2M4P6W9Y1Z3B6",
  "createdAt": "2026-04-10T08:00:00.000Z",
  "updatedAt": "2026-04-15T10:30:00.000Z",
  "appliedAt": "2026-04-15T10:30:00.000Z",
  "version": 2
}
```

### StatusHistory Entity

Tracks all status transitions for an application.

**Key Pattern**:
- `PK`: `USER#{userId}`
- `SK`: `APP#{applicationId}#HISTORY#{timestamp}`

**Attributes**:

```typescript
interface StatusHistoryEntity {
  // Keys
  PK: `USER#${string}`;
  SK: `APP#${string}#HISTORY#${string}`;
  
  // Metadata
  entityType: 'STATUS_HISTORY';
  
  // Fields
  applicationId: string;
  fromStatus: ApplicationStatus | null;  // null for initial creation
  toStatus: ApplicationStatus;
  changedAt: string;                      // ISO 8601
  note?: string;                          // Optional reason
}
```

**Example Item**:

```json
{
  "PK": "USER#550e8400-e29b-41d4-a716-446655440000",
  "SK": "APP#01HXK5R3J7Q8N2M4P6W9Y1Z3A5#HISTORY#2026-04-15T10:30:00.000Z",
  "entityType": "STATUS_HISTORY",
  "applicationId": "01HXK5R3J7Q8N2M4P6W9Y1Z3A5",
  "fromStatus": "saved",
  "toStatus": "applied",
  "changedAt": "2026-04-15T10:30:00.000Z",
  "note": "Submitted via company portal"
}
```

### UserStats Entity

Aggregated statistics for dashboard, updated on each application change.

**Key Pattern**:
- `PK`: `USER#{userId}`
- `SK`: `STATS`

**Attributes**:

```typescript
interface UserStatsEntity {
  // Keys
  PK: `USER#${string}`;
  SK: 'STATS';
  
  // Metadata
  entityType: 'USER_STATS';
  
  // Counts by status
  counts: {
    saved: number;
    applied: number;
    phone_screen: number;
    interview: number;
    offer: number;
    rejected: number;
    withdrawn: number;
    total: number;
  };
  
  // Time-based stats
  appliedThisWeek: number;
  appliedThisMonth: number;
  
  // Calculated metrics
  responseRate: number;  // (phone_screen + interview + offer + rejected) / applied
  
  // Last updated
  updatedAt: string;
}
```

**Example Item**:

```json
{
  "PK": "USER#550e8400-e29b-41d4-a716-446655440000",
  "SK": "STATS",
  "entityType": "USER_STATS",
  "counts": {
    "saved": 5,
    "applied": 12,
    "phone_screen": 3,
    "interview": 2,
    "offer": 0,
    "rejected": 4,
    "withdrawn": 1,
    "total": 27
  },
  "appliedThisWeek": 3,
  "appliedThisMonth": 8,
  "responseRate": 0.75,
  "updatedAt": "2026-04-15T10:30:00.000Z"
}
```

## Access Patterns

### Primary Table Access Patterns

| Access Pattern | Key Condition | Use Case |
|----------------|---------------|----------|
| Get application by ID | `PK = USER#{userId}` AND `SK = APP#{appId}` | View application detail |
| List all applications | `PK = USER#{userId}` AND `SK BEGINS_WITH APP#` | Dashboard list view |
| Get application with history | `PK = USER#{userId}` AND `SK BEGINS_WITH APP#{appId}` | Detail view with timeline |
| Get user stats | `PK = USER#{userId}` AND `SK = STATS` | Dashboard stats |

### GSI1 Access Patterns

| Access Pattern | Key Condition | Use Case |
|----------------|---------------|----------|
| List by status | `GSI1PK = USER#{userId}#STATUS#{status}` | Kanban column |
| List by status + date range | `GSI1PK = ...` AND `GSI1SK BETWEEN {start} AND {end}` | Filtered view |
| Recent by status | `GSI1PK = ...` AND `GSI1SK > {date}` | "Applied this week" |

## Status Transition Rules

Valid transitions are enforced at the application layer:

```typescript
const VALID_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  saved: ['applied', 'withdrawn'],
  applied: ['phone_screen', 'rejected', 'withdrawn'],
  phone_screen: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: [],        // Terminal state
  rejected: [],     // Terminal state
  withdrawn: [],    // Terminal state
};

function isValidTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
```

## Write Operations

### Create Application

```typescript
// Transaction: Create application + update stats + create initial history
const transactItems = [
  {
    Put: {
      TableName: TABLE_NAME,
      Item: applicationItem,
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  },
  {
    Update: {
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'STATS' },
      UpdateExpression: 'ADD counts.#status :one, counts.total :one SET updatedAt = :now',
      ExpressionAttributeNames: { '#status': status },
      ExpressionAttributeValues: { ':one': 1, ':now': now },
    },
  },
  {
    Put: {
      TableName: TABLE_NAME,
      Item: statusHistoryItem,
    },
  },
];
```

### Update Status

```typescript
// Transaction: Update application + create history + update stats
const transactItems = [
  {
    Update: {
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: `APP#${appId}` },
      UpdateExpression: 'SET #status = :newStatus, GSI1PK = :newGsi1pk, updatedAt = :now, version = version + :one',
      ConditionExpression: '#status = :oldStatus AND version = :expectedVersion',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':newStatus': newStatus,
        ':oldStatus': oldStatus,
        ':newGsi1pk': `USER#${userId}#STATUS#${newStatus}`,
        ':now': now,
        ':one': 1,
        ':expectedVersion': currentVersion,
      },
    },
  },
  {
    Put: {
      TableName: TABLE_NAME,
      Item: statusHistoryItem,
    },
  },
  {
    Update: {
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'STATS' },
      UpdateExpression: 'ADD counts.#old :negOne, counts.#new :one SET updatedAt = :now',
      ExpressionAttributeNames: { '#old': oldStatus, '#new': newStatus },
      ExpressionAttributeValues: { ':negOne': -1, ':one': 1, ':now': now },
    },
  },
];
```

### Delete Application

```typescript
// Query all items for application (including history), then batch delete
// Also update stats
```

## TypeScript Entity Types

```typescript
// types/entities.ts

export type EntityType = 'APPLICATION' | 'STATUS_HISTORY' | 'USER_STATS';

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export interface BaseEntity {
  PK: string;
  SK: string;
  entityType: EntityType;
}

export interface ApplicationEntity extends BaseEntity {
  entityType: 'APPLICATION';
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  userId: string;
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  status: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  version: number;
}

export interface StatusHistoryEntity extends BaseEntity {
  entityType: 'STATUS_HISTORY';
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  note?: string;
}

export interface UserStatsEntity extends BaseEntity {
  entityType: 'USER_STATS';
  counts: Record<ApplicationStatus | 'total', number>;
  appliedThisWeek: number;
  appliedThisMonth: number;
  responseRate: number;
  updatedAt: string;
}

export type Entity = ApplicationEntity | StatusHistoryEntity | UserStatsEntity;
```

## CDK Table Definition

```typescript
// lib/constructs/database.ts

import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseConstruct extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new Table(this, 'ApplicationsTable', {
      tableName: 'JobApplicationManager-Applications',
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
    });
  }
}
```

## Data Migration Considerations

### From Existing Filesystem Storage

If migrating from the existing resume/cover letter filesystem storage:

1. **Documents stay in filesystem**: Resume PDFs and cover letters remain file-based
2. **References stored in DynamoDB**: `coverLetterId` and `resumeVersionId` point to file paths
3. **Migration script**: One-time import of any existing application data

### Backup Strategy

- **Point-in-time recovery**: Enabled for continuous backups
- **On-demand backups**: Before major releases
- **Cross-region replication**: Consider for disaster recovery (Phase 2+)

## References

- [Architecture Overview](./ARCHITECTURE.md)
- [API Contracts](./API_CONTRACTS.md)
- [AWS DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
