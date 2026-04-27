# Job Application Manager — API Contracts

## Overview

This document defines the REST API contracts for the Job Application Manager backend. The API runs locally on the user's machine via a Fastify server.

## Base URL

```
http://localhost:3000/api
```

The API runs entirely locally. No cloud endpoints or external authentication required.

## Authentication

**Single-user mode (default)**: No authentication required. The application runs locally and serves one user.

**Optional multi-user mode**: If enabled, use session-based auth:

```
Cookie: session=<session_token>
```

## Common Response Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (successful delete) |
| 400 | Bad Request (validation error) |
| 404 | Not Found |
| 409 | Conflict (version mismatch or invalid status transition) |
| 500 | Internal Server Error |

## Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable error code
    message: string;        // Human-readable message
    details?: unknown;      // Additional error details
  };
}
```

**Example**:

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Cannot transition from 'saved' to 'interview'",
    "details": {
      "currentStatus": "saved",
      "requestedStatus": "interview",
      "allowedStatuses": ["applied", "withdrawn"]
    }
  }
}
```

---

## Endpoints

### Applications

#### List Applications

```
GET /applications
```

Returns all applications for the authenticated user.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status (comma-separated for multiple) |
| `company` | string | No | Filter by company name (partial match) |
| `search` | string | No | Search in job title and company |
| `sortBy` | string | No | Sort field: `createdAt`, `updatedAt`, `company` (default: `updatedAt`) |
| `sortOrder` | string | No | `asc` or `desc` (default: `desc`) |
| `limit` | number | No | Max results (default: 50, max: 100) |
| `cursor` | string | No | Pagination cursor from previous response |

**Response**: `200 OK`

```typescript
interface ListApplicationsResponse {
  applications: Application[];
  nextCursor?: string;       // For pagination
  totalCount: number;        // Total matching applications
}

interface Application {
  id: string;
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  status: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
  appliedAt?: string;        // ISO 8601
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

**Example Request**:

```bash
curl -X GET "https://api.example.com/v1/applications?status=applied,phone_screen&sortBy=updatedAt" \
  -H "Authorization: Bearer <token>"
```

**Example Response**:

```json
{
  "applications": [
    {
      "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3A5",
      "jobTitle": "Senior Software Engineer",
      "company": "Acme Corp",
      "url": "https://acme.com/careers/senior-swe",
      "location": "Remote (US)",
      "salaryRange": "$150k-180k",
      "status": "applied",
      "coverLetterId": "01HXK5R3J7Q8N2M4P6W9Y1Z3B6",
      "createdAt": "2026-04-10T08:00:00.000Z",
      "updatedAt": "2026-04-15T10:30:00.000Z",
      "appliedAt": "2026-04-15T10:30:00.000Z"
    }
  ],
  "nextCursor": "eyJQSyI6IlVTRVIjNTUwZTg0MDAiLCJTSyI6IkFQUCMwMUhYSzVSM0o3UTh...",
  "totalCount": 27
}
```

---

#### Get Application

```
GET /applications/{id}
```

Returns a single application with its status history.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Application ID (ULID) |

**Response**: `200 OK`

```typescript
interface GetApplicationResponse {
  application: Application;
  statusHistory: StatusHistoryEntry[];
}

interface StatusHistoryEntry {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;         // ISO 8601
  note?: string;
}
```

**Example Response**:

```json
{
  "application": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3A5",
    "jobTitle": "Senior Software Engineer",
    "company": "Acme Corp",
    "url": "https://acme.com/careers/senior-swe",
    "location": "Remote (US)",
    "salaryRange": "$150k-180k",
    "status": "applied",
    "coverLetterId": "01HXK5R3J7Q8N2M4P6W9Y1Z3B6",
    "createdAt": "2026-04-10T08:00:00.000Z",
    "updatedAt": "2026-04-15T10:30:00.000Z",
    "appliedAt": "2026-04-15T10:30:00.000Z"
  },
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "saved",
      "changedAt": "2026-04-10T08:00:00.000Z"
    },
    {
      "fromStatus": "saved",
      "toStatus": "applied",
      "changedAt": "2026-04-15T10:30:00.000Z",
      "note": "Submitted via company portal"
    }
  ]
}
```

---

#### Create Application

```
POST /applications
```

Creates a new job application.

**Request Body**:

```typescript
interface CreateApplicationRequest {
  jobTitle: string;          // Required, 1-200 chars
  company: string;           // Required, 1-200 chars
  url?: string;              // Optional, valid URL
  location?: string;         // Optional, 1-100 chars
  salaryRange?: string;      // Optional, 1-50 chars
  status?: ApplicationStatus; // Optional, default: 'saved'
  coverLetterId?: string;    // Optional, existing cover letter ID
  resumeVersionId?: string;  // Optional, existing resume version ID
}
```

**Response**: `201 Created`

```typescript
interface CreateApplicationResponse {
  application: Application;
}
```

**Example Request**:

```bash
curl -X POST "https://api.example.com/v1/applications" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jobTitle": "Senior Software Engineer",
    "company": "Acme Corp",
    "url": "https://acme.com/careers/senior-swe",
    "location": "Remote (US)",
    "salaryRange": "$150k-180k"
  }'
```

---

#### Update Application

```
PATCH /applications/{id}
```

Updates an application's fields (except status, use status endpoint).

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Application ID (ULID) |

**Request Body**:

```typescript
interface UpdateApplicationRequest {
  jobTitle?: string;
  company?: string;
  url?: string | null;       // null to clear
  location?: string | null;
  salaryRange?: string | null;
  coverLetterId?: string | null;
  resumeVersionId?: string | null;
  version: number;           // Required for optimistic locking
}
```

**Response**: `200 OK`

```typescript
interface UpdateApplicationResponse {
  application: Application;
}
```

**Error**: `409 Conflict` if version doesn't match (concurrent update)

---

#### Delete Application

```
DELETE /applications/{id}
```

Deletes an application and its status history.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Application ID (ULID) |

**Response**: `204 No Content`

---

#### Update Application Status

```
POST /applications/{id}/status
```

Updates the status of an application with transition validation.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Application ID (ULID) |

**Request Body**:

```typescript
interface UpdateStatusRequest {
  status: ApplicationStatus;  // Required, target status
  note?: string;              // Optional, reason for change (1-500 chars)
  version: number;            // Required for optimistic locking
}
```

**Response**: `200 OK`

```typescript
interface UpdateStatusResponse {
  application: Application;
  statusHistory: StatusHistoryEntry[];
}
```

**Error Cases**:

- `400 Bad Request` with code `INVALID_STATUS_TRANSITION` if transition not allowed
- `409 Conflict` if version doesn't match

**Example Request**:

```bash
curl -X POST "https://api.example.com/v1/applications/01HXK5R3J7Q8N2M4P6W9Y1Z3A5/status" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "applied",
    "note": "Submitted via company portal",
    "version": 1
  }'
```

---

### Dashboard

#### Get Dashboard Stats

```
GET /dashboard
```

Returns aggregated statistics for the authenticated user.

**Response**: `200 OK`

```typescript
interface DashboardResponse {
  stats: {
    total: number;
    byStatus: Record<ApplicationStatus, number>;
    appliedThisWeek: number;
    appliedThisMonth: number;
    responseRate: number;     // 0-1, percentage of applications with response
  };
  recentActivity: ActivityItem[];
}

interface ActivityItem {
  applicationId: string;
  jobTitle: string;
  company: string;
  action: 'created' | 'status_changed';
  fromStatus?: ApplicationStatus;
  toStatus: ApplicationStatus;
  timestamp: string;          // ISO 8601
}
```

**Example Response**:

```json
{
  "stats": {
    "total": 27,
    "byStatus": {
      "saved": 5,
      "applied": 12,
      "phone_screen": 3,
      "interview": 2,
      "offer": 0,
      "rejected": 4,
      "withdrawn": 1
    },
    "appliedThisWeek": 3,
    "appliedThisMonth": 8,
    "responseRate": 0.75
  },
  "recentActivity": [
    {
      "applicationId": "01HXK5R3J7Q8N2M4P6W9Y1Z3A5",
      "jobTitle": "Senior Software Engineer",
      "company": "Acme Corp",
      "action": "status_changed",
      "fromStatus": "saved",
      "toStatus": "applied",
      "timestamp": "2026-04-15T10:30:00.000Z"
    }
  ]
}
```

---

### Cover Letters (Read-Only Reference)

These endpoints reference existing cover letter functionality.

#### List Cover Letters

```
GET /cover-letters
```

Returns available cover letters for linking to applications.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Search in keywords/content |
| `limit` | number | No | Max results (default: 20) |

**Response**: `200 OK`

```typescript
interface ListCoverLettersResponse {
  coverLetters: CoverLetterSummary[];
}

interface CoverLetterSummary {
  id: string;
  title: string;              // Generated or user-provided
  keywords: string[];         // Extracted keywords
  createdAt: string;          // ISO 8601
  preview: string;            // First 200 chars
}
```

---

## TypeScript SDK Types

For frontend integration, use these TypeScript interfaces:

```typescript
// types/api.ts

// === Request Types ===

export interface CreateApplicationRequest {
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  status?: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
}

export interface UpdateApplicationRequest {
  jobTitle?: string;
  company?: string;
  url?: string | null;
  location?: string | null;
  salaryRange?: string | null;
  coverLetterId?: string | null;
  resumeVersionId?: string | null;
  version: number;
}

export interface UpdateStatusRequest {
  status: ApplicationStatus;
  note?: string;
  version: number;
}

export interface ListApplicationsParams {
  status?: ApplicationStatus | ApplicationStatus[];
  company?: string;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'company';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

// === Response Types ===

export interface Application {
  id: string;
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

export interface StatusHistoryEntry {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  note?: string;
}

export interface DashboardStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  appliedThisWeek: number;
  appliedThisMonth: number;
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

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

// === API Client Interface ===

export interface ApplicationsApi {
  list(params?: ListApplicationsParams): Promise<{
    applications: Application[];
    nextCursor?: string;
    totalCount: number;
  }>;
  
  get(id: string): Promise<{
    application: Application;
    statusHistory: StatusHistoryEntry[];
  }>;
  
  create(data: CreateApplicationRequest): Promise<{
    application: Application;
  }>;
  
  update(id: string, data: UpdateApplicationRequest): Promise<{
    application: Application;
  }>;
  
  delete(id: string): Promise<void>;
  
  updateStatus(id: string, data: UpdateStatusRequest): Promise<{
    application: Application;
    statusHistory: StatusHistoryEntry[];
  }>;
}

export interface DashboardApi {
  getStats(): Promise<{
    stats: DashboardStats;
    recentActivity: ActivityItem[];
  }>;
}
```

## Mock API for Frontend Development

While the backend is being implemented, use these mock responses:

```typescript
// mocks/applications.ts

export const mockApplications: Application[] = [
  {
    id: '01HXK5R3J7Q8N2M4P6W9Y1Z3A5',
    jobTitle: 'Senior Software Engineer',
    company: 'Acme Corp',
    url: 'https://acme.com/careers/senior-swe',
    location: 'Remote (US)',
    salaryRange: '$150k-180k',
    status: 'applied',
    coverLetterId: '01HXK5R3J7Q8N2M4P6W9Y1Z3B6',
    createdAt: '2026-04-10T08:00:00.000Z',
    updatedAt: '2026-04-15T10:30:00.000Z',
    appliedAt: '2026-04-15T10:30:00.000Z',
    version: 2,
  },
  {
    id: '01HXK5R3J7Q8N2M4P6W9Y1Z3A6',
    jobTitle: 'Staff Engineer',
    company: 'TechStart Inc',
    location: 'San Francisco, CA',
    salaryRange: '$180k-220k',
    status: 'phone_screen',
    createdAt: '2026-04-08T14:00:00.000Z',
    updatedAt: '2026-04-14T09:00:00.000Z',
    appliedAt: '2026-04-10T11:00:00.000Z',
    version: 3,
  },
  {
    id: '01HXK5R3J7Q8N2M4P6W9Y1Z3A7',
    jobTitle: 'Principal Engineer',
    company: 'BigTech Co',
    url: 'https://bigtech.com/jobs/principal',
    location: 'Remote',
    status: 'saved',
    createdAt: '2026-04-14T16:00:00.000Z',
    updatedAt: '2026-04-14T16:00:00.000Z',
    version: 1,
  },
];

export const mockDashboardStats: DashboardStats = {
  total: 27,
  byStatus: {
    saved: 5,
    applied: 12,
    phone_screen: 3,
    interview: 2,
    offer: 0,
    rejected: 4,
    withdrawn: 1,
  },
  appliedThisWeek: 3,
  appliedThisMonth: 8,
  responseRate: 0.75,
};
```

---

### Catalog (UC-2 Master Catalog Index)

The Catalog API provides endpoints for managing the normalized knowledge base of professional attributes extracted from resumes and applications. All endpoints are under `/catalog`.

#### Diffs

##### List Diffs

```
GET /catalog/diffs
```

Returns a paginated list of catalog change diffs.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status: `pending`, `approved`, `rejected`, `partial`, `expired` |
| `limit` | number | No | Max results (default: 20, max: 100) |
| `cursor` | string | No | Pagination cursor (base64url-encoded offset) |

**Response**: `200 OK`

```typescript
interface ListDiffsResponse {
  diffs: DiffSummary[];
  nextCursor?: string;
}

interface DiffSummary {
  id: string;
  triggerSource: 'resume_upload' | 'application_update';
  triggerId: string;
  summary: string;
  changeCount: number;
  pendingReviewCount: number;
  status: DiffStatus;
  createdAt: string;    // ISO 8601
  expiresAt: string;    // ISO 8601 (7 days from creation)
}

type DiffStatus = 'pending' | 'approved' | 'rejected' | 'partial' | 'expired';
```

---

##### Get Diff

```
GET /catalog/diffs/:id
```

Returns a single diff with its full change list and pending review items.

**Response**: `200 OK`

```typescript
interface GetDiffResponse {
  id: string;
  triggerSource: string;
  triggerId: string;
  summary: string;
  status: DiffStatus;
  createdAt: string;
  expiresAt: string;
  changes: DiffChange[];
  pendingReview: ReviewItem[];
}

interface DiffChange {
  entity: 'company_catalog' | 'tech_stack_tags' | 'job_fit_tags' | 'quantified_bullets' | 'recurring_themes';
  action: 'create' | 'update' | 'delete' | 'merge';
  data: Record<string, unknown>;
  sourceName?: string;
}

interface ReviewItem {
  type: 'ambiguous_tag' | 'fuzzy_match' | 'unresolved_wikilink';
  value: string;
  options?: string[];
  confidence?: number;   // 0–1, match confidence
}
```

---

##### Generate Diff

```
POST /catalog/generate-diff
```

Triggers extraction and diff generation from a source document.

**Request Body**:

```typescript
interface GenerateDiffRequest {
  sourceType: 'resume' | 'application';
  sourceId: string;
}
```

**Response**: `201 Created` — returns the full diff object (same shape as `GET /catalog/diffs/:id`)

---

##### Apply Diff

```
POST /catalog/diffs/:id/apply
```

Applies some or all changes from a diff to the catalog.

**Request Body**:

```typescript
interface ApplyDiffRequest {
  action: 'approve_all' | 'reject_all' | 'partial';
  // Required when action = 'partial':
  decisions?: Array<{
    changeIndex: number;
    approved: boolean;
  }>;
  reviewDecisions?: Array<{
    reviewIndex: number;
    selectedOption?: string;
    action: 'resolve' | 'skip' | 'create_new';
  }>;
}
```

**Response**: `200 OK`

```typescript
interface ApplyDiffResponse {
  applied: number;
  rejected: number;
  pendingReview: number;
  status: DiffStatus;
}
```

**Example**:

```bash
curl -X POST "http://localhost:3000/api/catalog/diffs/01HXK5R3J7/apply" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "partial",
    "decisions": [
      { "changeIndex": 0, "approved": true },
      { "changeIndex": 1, "approved": false }
    ],
    "reviewDecisions": [
      { "reviewIndex": 0, "selectedOption": "Product Manager", "action": "resolve" }
    ]
  }'
```

---

##### Resolve Single Item

```
POST /catalog/diffs/:id/resolve
```

Resolves a single change or review item within a pending diff.

**Request Body**:

```typescript
interface ResolveItemRequest {
  itemType: 'change' | 'review';
  itemIndex: number;
  decision: 'approve' | 'reject';
  selectedOption?: string;  // Required when resolving a review item
}
```

**Response**: `200 OK`

```typescript
interface ResolveItemResponse {
  id: string;
  updated: boolean;
}
```

---

##### Delete Diff

```
DELETE /catalog/diffs/:id
```

Permanently discards a pending diff.

**Response**: `204 No Content`

---

#### Companies

##### List Companies

```
GET /catalog/companies
```

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Search by name or alias |
| `includeDeleted` | boolean | No | Include soft-deleted entries (default: false) |
| `limit` | number | No | Max results (default: 250, max: 250) |
| `cursor` | string | No | Pagination cursor |

**Response**: `200 OK`

```typescript
interface ListCompaniesResponse {
  companies: CompanyDTO[];
  nextCursor?: string;
}

interface CompanyDTO {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  firstSeenAt: string;
  applicationCount: number;
  latestStatus: ApplicationStatus | null;
  isDeleted: boolean;
  version: number;
}
```

---

##### Merge Companies

```
POST /catalog/companies/merge
```

Merges multiple company entries into one canonical entry.

**Request Body**:

```typescript
interface MergeCompaniesRequest {
  sourceCompanyIds: string[];
  targetCompanyId: string;
}
```

**Response**: `200 OK`

```typescript
interface MergeCompaniesResponse {
  mergedCompany: CompanyDTO;
  mergedCount: number;
}
```

---

#### Tags

Tags come in two types: `job-fit` and `tech-stack`. The `:type` path parameter selects which table to operate on.

##### List Tags

```
GET /catalog/tags/:type
```

**Path Parameters**: `:type` = `job-fit` | `tech-stack`

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by category (see enum values below) |
| `needsReview` | boolean | No | Filter to tags flagged for review |
| `search` | string | No | Search by slug or display name |
| `limit` | number | No | Max results (default: 250, max: 250) |
| `cursor` | string | No | Pagination cursor |

**Response**: `200 OK`

```typescript
interface ListTagsResponse {
  tags: TagDTO[];
  nextCursor?: string;
}

interface TagDTO {
  id: string;
  tagSlug: string;
  displayName: string;
  category: string;
  mentionCount: number;
  needsReview: boolean;
  reviewOptions: string[] | null;
  version: number;
}
```

**Category values — `job-fit`**: `role`, `industry`, `seniority`, `work_style`, `uncategorized`

**Category values — `tech-stack`**: `language`, `frontend`, `backend`, `database`, `cloud`, `devops`, `ai_ml`, `uncategorized`

---

##### Update Tag

```
PATCH /catalog/tags/:type/:id
```

**Request Body**:

```typescript
interface UpdateTagRequest {
  displayName?: string;
  category?: string;
  needsReview?: boolean;
  version: number;   // Required for optimistic locking
}
```

**Response**: `200 OK` — returns updated `TagDTO`

**Error**: `409 Conflict` if `version` doesn't match

---

##### Merge Tags

```
POST /catalog/tags/:type/merge
```

**Request Body**:

```typescript
interface MergeTagsRequest {
  sourceTagIds: string[];
  targetTagId: string;
}
```

**Response**: `200 OK`

```typescript
interface MergeTagsResponse {
  mergedTag: TagDTO;
  mergedCount: number;
}
```

---

#### Quantified Bullets

##### List Quantified Bullets

```
GET /catalog/quantified-bullets
```

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `impactCategory` | string | No | Filter by category: `revenue`, `cost_savings`, `efficiency`, `team_leadership`, `user_growth`, `performance`, `other` |
| `sourceId` | string | No | Filter by source document ID |
| `limit` | number | No | Max results (default: 250, max: 250) |
| `cursor` | string | No | Pagination cursor |

**Response**: `200 OK`

```typescript
interface ListBulletsResponse {
  bullets: BulletDTO[];
  nextCursor?: string;
}

interface BulletDTO {
  id: string;
  sourceType: 'resume' | 'application';
  sourceId: string;
  rawText: string;
  actionVerb: string | null;
  metricType: 'percentage' | 'currency' | 'count' | 'time' | 'multiplier' | null;
  metricValue: number | null;
  isApproximate: boolean;
  secondaryMetricType: string | null;
  secondaryMetricValue: number | null;
  impactCategory: string;
  extractedAt: string;   // ISO 8601
}
```

---

#### Themes

##### List Themes

```
GET /catalog/themes
```

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `coreOnly` | boolean | No | Return only `isCoreStrength` themes |
| `includeHistorical` | boolean | No | Include themes marked as historical |
| `limit` | number | No | Max results (default: 250, max: 250) |
| `cursor` | string | No | Pagination cursor |

**Response**: `200 OK`

```typescript
interface ListThemesResponse {
  themes: ThemeDTO[];
  nextCursor?: string;
}

interface ThemeDTO {
  id: string;
  themeSlug: string;
  displayName: string;
  occurrenceCount: number;
  sourceIds: string[];
  exampleExcerpts: string[];
  isCoreStrength: boolean;   // true when occurrenceCount >= 3
  isHistorical: boolean;
  lastSeenAt: string;        // ISO 8601
}
```

---

#### Catalog Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `DIFF_NOT_FOUND` | 404 | Diff ID does not exist |
| `DIFF_EXPIRED` | 409 | Diff has passed its 7-day expiry |
| `DIFF_ALREADY_APPLIED` | 409 | Diff is not in `pending` status |
| `INVALID_CHANGE_INDEX` | 400 | `changeIndex` out of range for this diff |
| `INVALID_REVIEW_INDEX` | 400 | `reviewIndex` out of range for this diff |
| `TAG_VERSION_CONFLICT` | 409 | Tag `version` mismatch during update |
| `MERGE_SAME_ENTITY` | 400 | Source and target IDs overlap |
| `ENTITY_NOT_FOUND` | 404 | Catalog entity not found |

---

### Job Fit Analysis (UC-3)

Analyze job descriptions against the user's catalog to assess fit and identify gaps.

#### Analyze Job Description

```
POST /catalog/job-fit/analyze
```

Submits a job description for parsing and fit analysis against the user's catalog.

**Request Body**:

```typescript
interface AnalyzeJobFitRequest {
  // Exactly one of jobDescriptionText or jobDescriptionUrl required
  jobDescriptionText?: string;  // 50-50,000 characters
  jobDescriptionUrl?: string;   // Valid URL to job posting
}
```

**Response**: `200 OK`

```typescript
interface AnalyzeJobFitResponse {
  recommendation: 'strong_fit' | 'moderate_fit' | 'stretch' | 'low_fit' | null;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  
  parsedJd: ParsedJobDescription;
  
  strongMatches: FitMatch[];
  partialMatches: FitMatch[];
  gaps: FitGap[];
  recommendedStarEntries: RecommendedStarEntry[];
  
  catalogEmpty: boolean;
  analysisTimestamp: string;  // ISO 8601
}

interface ParsedJobDescription {
  roleTitle: string | null;
  seniority: Seniority | null;
  seniorityConfidence: 'high' | 'medium' | 'low';
  requiredStack: string[];       // Normalized tech stack tags
  niceToHaveStack: string[];     // Normalized tech stack tags
  industries: string[];          // Normalized job fit tags
  teamScope: string | null;      // e.g., "IC", "Manager of 5", "Cross-functional"
  location: string | null;       // e.g., "Remote (US)", "San Francisco, CA"
  compensation: string | null;   // e.g., "$150k-180k + equity"
}

type Seniority = 
  | 'entry'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'director'
  | 'vp'
  | 'c_level';

interface FitMatch {
  type: 'tech_stack' | 'job_fit' | 'seniority';
  catalogEntry: string;       // Tag slug or display name from user's catalog
  jdRequirement: string;      // Original text from JD that was matched
  matchType: 'exact' | 'alias' | 'related';
  isRequired: boolean;        // true if from required stack, false if nice-to-have
}

interface FitGap {
  type: 'tech_stack' | 'job_fit' | 'seniority';
  jdRequirement: string;      // Original text from JD with no match
  isRequired: boolean;
  severity: 'critical' | 'moderate' | 'minor';
}

interface RecommendedStarEntry {
  id: string;
  rawText: string;
  impactCategory: string;
  relevanceScore: number;     // 0-1, how relevant to this JD
}
```

**Response Headers**:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when window resets |

**Scoring Algorithm**:

The `recommendation` field is computed as follows:
- `strong_fit`: ≥80% of required skills matched, ≤1 critical gap
- `moderate_fit`: 50-79% of required skills matched, ≤3 critical gaps  
- `stretch`: 30-49% of required skills matched, or seniority mismatch
- `low_fit`: <30% of required skills matched
- `null`: Catalog is empty (see `catalogEmpty: true`)

Partial matches (alias/related) count at 0.5x weight toward match percentage.

**Example Request (text)**:

```bash
curl -X POST "http://localhost:3000/api/catalog/job-fit/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "jobDescriptionText": "Senior Software Engineer at Acme Corp...\n\nRequirements:\n- 5+ years TypeScript/JavaScript\n- React or Vue experience\n- PostgreSQL or MySQL\n- AWS or GCP cloud experience\n\nNice to have:\n- GraphQL\n- Kubernetes"
  }'
```

**Example Request (URL)**:

```bash
curl -X POST "http://localhost:3000/api/catalog/job-fit/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "jobDescriptionUrl": "https://boards.greenhouse.io/acme/jobs/12345"
  }'
```

**Example Response**:

```json
{
  "recommendation": "moderate_fit",
  "summary": "You match 4 of 6 required skills. Gaps in AWS/GCP cloud experience and PostgreSQL are addressable with your Azure and MongoDB experience.",
  "confidence": "high",
  "parsedJd": {
    "roleTitle": "Senior Software Engineer",
    "seniority": "senior",
    "seniorityConfidence": "high",
    "requiredStack": ["typescript", "javascript", "react", "vue", "postgresql", "mysql", "aws", "gcp"],
    "niceToHaveStack": ["graphql", "kubernetes"],
    "industries": [],
    "teamScope": null,
    "location": null,
    "compensation": null
  },
  "strongMatches": [
    {
      "type": "tech_stack",
      "catalogEntry": "typescript",
      "jdRequirement": "TypeScript/JavaScript",
      "matchType": "exact",
      "isRequired": true
    },
    {
      "type": "tech_stack",
      "catalogEntry": "react",
      "jdRequirement": "React or Vue experience",
      "matchType": "exact",
      "isRequired": true
    },
    {
      "type": "seniority",
      "catalogEntry": "senior",
      "jdRequirement": "Senior Software Engineer",
      "matchType": "exact",
      "isRequired": true
    }
  ],
  "partialMatches": [
    {
      "type": "tech_stack",
      "catalogEntry": "mongodb",
      "jdRequirement": "PostgreSQL or MySQL",
      "matchType": "related",
      "isRequired": true
    }
  ],
  "gaps": [
    {
      "type": "tech_stack",
      "jdRequirement": "AWS or GCP cloud experience",
      "isRequired": true,
      "severity": "critical"
    }
  ],
  "recommendedStarEntries": [
    {
      "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
      "rawText": "Reduced API response times by 40% through query optimization and caching",
      "impactCategory": "performance",
      "relevanceScore": 0.85
    }
  ],
  "catalogEmpty": false,
  "analysisTimestamp": "2026-04-25T10:30:00.000Z"
}
```

**Example Response (empty catalog)**:

```json
{
  "recommendation": null,
  "summary": "Your catalog is empty. Upload a resume or add application history to enable fit analysis.",
  "confidence": "high",
  "parsedJd": {
    "roleTitle": "Senior Software Engineer",
    "seniority": "senior",
    "seniorityConfidence": "high",
    "requiredStack": ["typescript", "react"],
    "niceToHaveStack": [],
    "industries": [],
    "teamScope": null,
    "location": null,
    "compensation": null
  },
  "strongMatches": [],
  "partialMatches": [],
  "gaps": [],
  "recommendedStarEntries": [],
  "catalogEmpty": true,
  "analysisTimestamp": "2026-04-25T10:30:00.000Z"
}
```

---

#### Job Fit Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `JD_INPUT_REQUIRED` | 400 | Neither `jobDescriptionText` nor `jobDescriptionUrl` provided |
| `JD_INPUT_CONFLICT` | 400 | Both `jobDescriptionText` and `jobDescriptionUrl` provided |
| `JD_TEXT_TOO_SHORT` | 400 | `jobDescriptionText` is less than 50 characters |
| `JD_TEXT_TOO_LONG` | 400 | `jobDescriptionText` exceeds 50,000 characters |
| `JD_URL_INVALID` | 400 | `jobDescriptionUrl` is not a valid URL |
| `JD_PARSE_FAILED` | 422 | Unable to extract job requirements from the provided text |
| `URL_FETCH_FAILED` | 422 | Could not retrieve job description from URL (blocked, timeout, etc.) |
| `URL_FETCH_TIMEOUT` | 422 | URL fetch exceeded 10 second timeout |
| `RATE_LIMIT_EXCEEDED` | 429 | Request rate limit exceeded (see headers) |

**Error Response Example**:

```json
{
  "error": {
    "code": "URL_FETCH_FAILED",
    "message": "Could not retrieve job description from URL. The site may be blocking automated access. Please paste the job description text directly.",
    "details": {
      "url": "https://example.com/job/123",
      "httpStatus": 403
    }
  }
}
```

---

#### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/catalog/job-fit/analyze` (text) | 30 requests | 1 minute |
| `/catalog/job-fit/analyze` (URL) | 10 requests | 1 minute |

Rate limits are per session. When exceeded, responses return `429 Too Many Requests` with `Retry-After` header.

---

### Cover Letter Generation (UC-4)

AI-powered cover letter generation from catalog STAR entries, with support for revision and short-form outreach.

#### Data Model

```typescript
interface CoverLetter {
  id: string;                    // ULID
  status: 'draft' | 'finalized';
  title: string;                 // Auto-generated or user-provided
  targetCompany: string;
  targetRole: string;
  tone: TonePreference;
  lengthVariant: LengthVariant;
  emphasis: EmphasisPreference;  // Content focus: 'technical' | 'leadership' | 'balanced'
  jobDescriptionText?: string;   // Original JD text if provided
  jobDescriptionUrl?: string;    // Original JD URL if provided
  jobFitAnalysisId?: string;     // Reference to job fit analysis if used
  selectedStarEntryIds: string[];
  content: string;               // Generated markdown
  revisionHistory: RevisionEntry[];
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  version: number;
}

type TonePreference = 
  | 'professional'     // Default, formal business tone
  | 'conversational'   // Friendly but professional
  | 'enthusiastic'     // High energy, startup-friendly
  | 'technical';       // Emphasizes technical depth

type LengthVariant =
  | 'concise'          // ~200 words, 2-3 paragraphs
  | 'standard'         // ~350 words, 4-5 paragraphs (default)
  | 'detailed';        // ~500 words, 5-6 paragraphs

type EmphasisPreference =
  | 'technical'        // Focus on technical skills and achievements
  | 'leadership'       // Focus on leadership and team impact
  | 'balanced';        // Balanced mix (default)

interface RevisionEntry {
  id: string;
  instructions: string;
  previousContent: string;
  createdAt: string;             // ISO 8601
}
```

---

#### Generate Cover Letter

```
POST /cover-letters/generate
```

Generates a new cover letter using catalog STAR entries and optional job fit analysis.

**Request Body**:

```typescript
interface GenerateCoverLetterRequest {
  // Job context (at least one required)
  jobDescriptionText?: string;   // 50-50,000 characters
  jobDescriptionUrl?: string;    // Valid URL to job posting
  jobFitAnalysisId?: string;     // ID from prior /catalog/job-fit/analyze call

  // STAR entry selection
  selectedStarEntryIds: string[];  // At least 1, max 10 quantified bullet IDs

  // Target info (required if not using jobFitAnalysisId)
  targetCompany?: string;        // 1-200 characters
  targetRole?: string;           // 1-200 characters

  // Generation preferences
  tone?: TonePreference;         // Default: 'professional'
  lengthVariant?: LengthVariant; // Default: 'standard'
  emphasis?: EmphasisPreference; // Default: 'balanced'
  
  // Optional customization
  emphasizeThemes?: string[];    // Theme slugs to highlight
  customInstructions?: string;   // Additional guidance, max 500 chars
}
```

**Validation Rules**:

- At least one of `jobDescriptionText`, `jobDescriptionUrl`, or `jobFitAnalysisId` must be provided
- If `jobFitAnalysisId` is provided, `targetCompany` and `targetRole` are derived from the analysis
- If no `jobFitAnalysisId`, both `targetCompany` and `targetRole` are required
- `selectedStarEntryIds` must reference existing quantified bullets in the catalog
- Cannot combine `jobDescriptionText` and `jobDescriptionUrl` (conflict)

**Response**: `201 Created`

```typescript
interface GenerateCoverLetterResponse {
  coverLetter: CoverLetter;
  
  // Generation metadata
  usedStarEntries: UsedStarEntry[];
  matchedThemes: string[];       // Themes incorporated from catalog
  warnings: GenerationWarning[];
}

interface UsedStarEntry {
  id: string;
  rawText: string;
  placement: 'opening' | 'body' | 'closing';  // Where it was used
}

interface GenerationWarning {
  code: string;
  message: string;
}
```

**Warning Codes**:

| Code | Description |
|------|-------------|
| `STAR_ENTRY_LOW_RELEVANCE` | Selected STAR entry has low relevance to JD |
| `GAP_MENTIONED` | Cover letter addresses a skill gap honestly |
| `SENIORITY_MISMATCH` | Target role seniority differs from catalog profile |
| `LIMITED_STAR_ENTRIES` | Fewer STAR entries selected than recommended |

**Example Request**:

```bash
curl -X POST "http://localhost:3000/api/cover-letters/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "jobFitAnalysisId": "01HXK5R3J7Q8N2M4P6W9Y1Z3D8",
    "selectedStarEntryIds": [
      "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
      "01HXK5R3J7Q8N2M4P6W9Y1Z3C8"
    ],
    "tone": "professional",
    "lengthVariant": "standard"
  }'
```

**Example Response**:

```json
{
  "coverLetter": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3E1",
    "status": "draft",
    "title": "Cover Letter - Senior Software Engineer at Acme Corp",
    "targetCompany": "Acme Corp",
    "targetRole": "Senior Software Engineer",
    "tone": "professional",
    "lengthVariant": "standard",
    "jobFitAnalysisId": "01HXK5R3J7Q8N2M4P6W9Y1Z3D8",
    "selectedStarEntryIds": [
      "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
      "01HXK5R3J7Q8N2M4P6W9Y1Z3C8"
    ],
    "content": "Dear Hiring Manager,\n\nI am writing to express my interest in the Senior Software Engineer position at Acme Corp. With extensive experience in TypeScript and React, I am excited about the opportunity to contribute to your engineering team.\n\nIn my current role, I reduced API response times by 40% through query optimization and caching strategies, demonstrating my commitment to building performant systems. Additionally, I led the migration of a legacy codebase to TypeScript, improving developer productivity by 25%.\n\nWhile I have not worked directly with AWS, my experience with Azure cloud services provides a strong foundation for quickly adapting to your infrastructure. I am eager to expand my cloud expertise in this direction.\n\nI look forward to discussing how my technical skills and collaborative approach can benefit Acme Corp.\n\nSincerely,\n[Your Name]",
    "revisionHistory": [],
    "createdAt": "2026-04-26T14:30:00.000Z",
    "updatedAt": "2026-04-26T14:30:00.000Z",
    "version": 1
  },
  "usedStarEntries": [
    {
      "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
      "rawText": "Reduced API response times by 40% through query optimization and caching",
      "placement": "body"
    },
    {
      "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C8",
      "rawText": "Led TypeScript migration improving developer productivity by 25%",
      "placement": "body"
    }
  ],
  "matchedThemes": ["performance-optimization", "technical-leadership"],
  "warnings": [
    {
      "code": "GAP_MENTIONED",
      "message": "Cover letter addresses AWS gap with transferable Azure experience"
    }
  ]
}
```

---

#### Revise Cover Letter (UC-4a)

```
POST /cover-letters/{id}/revise
```

Revises an existing cover letter draft based on user instructions.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Cover letter ID (ULID) |

**Request Body**:

```typescript
interface ReviseCoverLetterRequest {
  instructions: string;            // 10-2,000 characters, revision guidance
  
  // Optional: update STAR selections
  selectedStarEntryIds?: string[]; // Replaces current selection if provided
  
  // Optional: update preferences
  tone?: TonePreference;
  lengthVariant?: LengthVariant;
  emphasis?: EmphasisPreference;
  
  version: number;                 // Required for optimistic locking
}
```

**Response**: `200 OK`

```typescript
interface ReviseCoverLetterResponse {
  coverLetter: CoverLetter;        // Updated with new content
  
  // Revision metadata
  changesApplied: string[];        // Summary of changes made
  usedStarEntries: UsedStarEntry[];
}
```

**Example Request**:

```bash
curl -X POST "http://localhost:3000/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/revise" \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": "Make the opening more enthusiastic and add a sentence about my passion for developer tooling",
    "version": 1
  }'
```

**Example Response**:

```json
{
  "coverLetter": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3E1",
    "status": "draft",
    "title": "Cover Letter - Senior Software Engineer at Acme Corp",
    "targetCompany": "Acme Corp",
    "targetRole": "Senior Software Engineer",
    "tone": "professional",
    "lengthVariant": "standard",
    "content": "Dear Hiring Manager,\n\nI am thrilled to apply for the Senior Software Engineer position at Acme Corp! Building great developer experiences is my passion, and I see a fantastic opportunity to bring that energy to your team.\n\n[...updated content...]",
    "revisionHistory": [
      {
        "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3F1",
        "instructions": "Make the opening more enthusiastic and add a sentence about my passion for developer tooling",
        "previousContent": "Dear Hiring Manager,\n\nI am writing to express my interest...",
        "createdAt": "2026-04-26T14:45:00.000Z"
      }
    ],
    "createdAt": "2026-04-26T14:30:00.000Z",
    "updatedAt": "2026-04-26T14:45:00.000Z",
    "version": 2
  },
  "changesApplied": [
    "Updated opening paragraph tone to enthusiastic",
    "Added developer tooling passion statement"
  ],
  "usedStarEntries": [
    {
      "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
      "rawText": "Reduced API response times by 40% through query optimization and caching",
      "placement": "body"
    }
  ]
}
```

---

#### Generate Outreach Message (UC-4b)

```
POST /cover-letters/outreach
```

Generates a short-form outreach message for LinkedIn or email.

**Request Body**:

```typescript
interface GenerateOutreachRequest {
  platform: 'linkedin' | 'email';
  
  // Target context
  targetName?: string;           // Recipient name (optional)
  targetTitle?: string;          // Recipient job title (optional)
  targetCompany: string;         // Required, 1-200 characters
  targetRole?: string;           // Role you're reaching out about (optional)
  
  // Content source (at least one)
  coverLetterId?: string;        // Derive from existing cover letter
  jobFitAnalysisId?: string;     // Derive from job fit analysis
  selectedStarEntryIds?: string[]; // Max 3 for short-form
  
  // Message customization
  keyPoints?: string[];          // 1-3 specific points to mention
  callToAction?: 'coffee_chat' | 'referral' | 'application_follow_up' | 'informational';
  
  // Optional constraints
  maxLength?: number;            // Character limit (LinkedIn default: 300, email: 500)
}
```

**Validation Rules**:

- At least one of `coverLetterId`, `jobFitAnalysisId`, or `selectedStarEntryIds` must be provided
- `selectedStarEntryIds` max 3 for outreach (keeps message concise)
- `keyPoints` max 3 items, each max 200 characters
- `maxLength` for LinkedIn capped at 500, for email capped at 1000

**Response**: `201 Created`

```typescript
interface GenerateOutreachResponse {
  message: OutreachMessage;
}

interface OutreachMessage {
  id: string;
  platform: 'linkedin' | 'email';
  targetCompany: string;
  targetRole?: string;
  subject?: string;              // Only for email
  body: string;
  characterCount: number;
  createdAt: string;             // ISO 8601
}
```

**Example Request (LinkedIn)**:

```bash
curl -X POST "http://localhost:3000/api/cover-letters/outreach" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "linkedin",
    "targetName": "Sarah Chen",
    "targetTitle": "Engineering Manager",
    "targetCompany": "Acme Corp",
    "targetRole": "Senior Software Engineer",
    "coverLetterId": "01HXK5R3J7Q8N2M4P6W9Y1Z3E1",
    "callToAction": "coffee_chat"
  }'
```

**Example Response (LinkedIn)**:

```json
{
  "message": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3G1",
    "platform": "linkedin",
    "targetCompany": "Acme Corp",
    "targetRole": "Senior Software Engineer",
    "body": "Hi Sarah,\n\nI came across the Senior Software Engineer opening at Acme Corp and am excited about the team's work on developer tooling. In my current role, I've driven 40% performance improvements through optimization work that aligns well with your infrastructure challenges.\n\nWould you have 15 minutes for a quick chat about the role and team?\n\nBest,\n[Your Name]",
    "characterCount": 298,
    "createdAt": "2026-04-26T15:00:00.000Z"
  }
}
```

**Example Request (Email)**:

```bash
curl -X POST "http://localhost:3000/api/cover-letters/outreach" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "email",
    "targetName": "Sarah Chen",
    "targetTitle": "Engineering Manager",
    "targetCompany": "Acme Corp",
    "targetRole": "Senior Software Engineer",
    "jobFitAnalysisId": "01HXK5R3J7Q8N2M4P6W9Y1Z3D8",
    "keyPoints": ["TypeScript expertise", "Performance optimization background"],
    "callToAction": "referral"
  }'
```

**Example Response (Email)**:

```json
{
  "message": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3G2",
    "platform": "email",
    "targetCompany": "Acme Corp",
    "targetRole": "Senior Software Engineer",
    "subject": "Senior Software Engineer Role at Acme Corp",
    "body": "Hi Sarah,\n\nI hope this email finds you well. I recently applied for the Senior Software Engineer position at Acme Corp and wanted to reach out directly.\n\nMy background in TypeScript and performance optimization aligns well with the role requirements. In my current position, I've led initiatives that reduced response times by 40% and improved developer productivity through tooling investments.\n\nIf you think I might be a good fit, I would greatly appreciate a referral or any insights you could share about the team.\n\nThank you for your time!\n\nBest regards,\n[Your Name]",
    "characterCount": 487,
    "createdAt": "2026-04-26T15:05:00.000Z"
  }
}
```

---

#### Export Cover Letter

```
POST /cover-letters/{id}/export
```

Exports a cover letter to downloadable document format.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Cover letter ID (ULID) |

**Request Body**:

```typescript
interface ExportCoverLetterRequest {
  format: 'docx' | 'pdf';
  
  // Document customization
  includeHeader?: boolean;       // Include name/contact header (default: false)
  headerInfo?: {
    name: string;
    email?: string;
    phone?: string;
    linkedin?: string;
  };
  
  // Styling (optional)
  fontFamily?: 'default' | 'serif' | 'modern';  // Default: 'default' (Calibri-like)
  fontSize?: 11 | 12;            // Default: 11
}
```

**Response**: `200 OK`

For `format: 'docx'` or `format: 'pdf'`:

```
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="cover-letter-acme-corp-2026-04-26.docx"

[binary file content]
```

**Alternative JSON Response** (if `Accept: application/json` header):

```typescript
interface ExportCoverLetterResponse {
  exportId: string;
  format: 'docx' | 'pdf';
  filename: string;
  fileSize: number;              // Bytes
  base64Content: string;         // Base64-encoded file
  createdAt: string;             // ISO 8601
}
```

**Example Request**:

```bash
curl -X POST "http://localhost:3000/api/cover-letters/01HXK5R3J7Q8N2M4P6W9Y1Z3E1/export" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "docx",
    "includeHeader": true,
    "headerInfo": {
      "name": "Alex Johnson",
      "email": "alex@example.com",
      "phone": "(555) 123-4567"
    }
  }' \
  -o cover-letter.docx
```

---

#### List Cover Letters

```
GET /cover-letters
```

Returns saved cover letters with search and filtering.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status: `draft`, `finalized` |
| `company` | string | No | Filter by target company (partial match) |
| `search` | string | No | Search in title, company, role, content |
| `limit` | number | No | Max results (default: 20, max: 100) |
| `cursor` | string | No | Pagination cursor |

**Response**: `200 OK`

```typescript
interface ListCoverLettersResponse {
  coverLetters: CoverLetterSummary[];
  nextCursor?: string;
}

interface CoverLetterSummary {
  id: string;
  status: 'draft' | 'finalized';
  title: string;
  targetCompany: string;
  targetRole: string;
  tone: TonePreference;
  lengthVariant: LengthVariant;
  preview: string;               // First 200 characters of content
  createdAt: string;
  updatedAt: string;
}
```

---

#### Get Cover Letter

```
GET /cover-letters/{id}
```

Returns a single cover letter with full content and revision history.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Cover letter ID (ULID) |

**Response**: `200 OK`

```typescript
interface GetCoverLetterResponse {
  coverLetter: CoverLetter;
  usedStarEntries: UsedStarEntry[];
}
```

---

#### Update Cover Letter

```
PATCH /cover-letters/{id}
```

Updates cover letter metadata (not content - use revise for that).

**Request Body**:

```typescript
interface UpdateCoverLetterRequest {
  title?: string;
  status?: 'draft' | 'finalized';
  version: number;               // Required for optimistic locking
}
```

**Response**: `200 OK` — returns updated `CoverLetter`

---

#### Delete Cover Letter

```
DELETE /cover-letters/{id}
```

Permanently deletes a cover letter.

**Response**: `204 No Content`

---

#### Cover Letter Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `COVER_LETTER_NOT_FOUND` | 404 | Cover letter ID does not exist |
| `JOB_CONTEXT_REQUIRED` | 400 | No job description, URL, or analysis ID provided |
| `JOB_CONTEXT_CONFLICT` | 400 | Both text and URL provided |
| `STAR_ENTRIES_REQUIRED` | 400 | No STAR entry IDs provided |
| `STAR_ENTRY_NOT_FOUND` | 404 | One or more STAR entry IDs invalid |
| `STAR_ENTRIES_LIMIT` | 400 | More than 10 STAR entries selected (3 for outreach) |
| `TARGET_INFO_REQUIRED` | 400 | Company/role required when not using job fit analysis |
| `REVISION_INSTRUCTIONS_REQUIRED` | 400 | Revise request missing instructions |
| `COVER_LETTER_VERSION_CONFLICT` | 409 | Version mismatch during update |
| `EXPORT_FORMAT_INVALID` | 400 | Unsupported export format |
| `CATALOG_EMPTY` | 422 | Cannot generate without catalog data |
| `FABRICATION_BLOCKED` | 422 | Request would require fabricating credentials |

**Error Response Example**:

```json
{
  "error": {
    "code": "STAR_ENTRY_NOT_FOUND",
    "message": "One or more selected STAR entry IDs do not exist in your catalog",
    "details": {
      "invalidIds": ["01HXK5R3J7Q8N2M4P6W9INVALID"]
    }
  }
}
```

---

#### Content Generation Constraints

The cover letter generation system enforces these constraints:

1. **No Fabrication**: Generated content only uses information from the user's catalog. Metrics, achievements, and credentials are never invented.

2. **Honest Gap Framing**: When the job fit analysis identifies gaps, the cover letter acknowledges them constructively (e.g., "While I haven't worked directly with X, my experience with Y provides a strong foundation").

3. **AI Attribution**: If the user's catalog indicates they used specific AI tools (e.g., "Built feature using Claude"), the cover letter preserves that attribution rather than genericizing to "AI tools."

4. **Length Compliance**: Generated content respects the `lengthVariant` constraint:
   - `concise`: 150-250 words
   - `standard`: 300-400 words
   - `detailed`: 450-550 words

5. **Outreach Brevity**: Outreach messages are constrained to platform norms:
   - LinkedIn: max 500 characters
   - Email: max 1000 characters

---

## References

- [Architecture Overview](./ARCHITECTURE.md)
- [Data Model](./DATA_MODEL.md)
- [User Flows](../design/USER_FLOWS.md)
