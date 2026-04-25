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

## References

- [Architecture Overview](./ARCHITECTURE.md)
- [Data Model](./DATA_MODEL.md)
- [User Flows](../design/USER_FLOWS.md)
