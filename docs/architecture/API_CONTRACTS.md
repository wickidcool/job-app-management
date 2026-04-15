# Job Application Manager — API Contracts

## Overview

This document defines the REST API contracts for the Job Application Manager backend. All endpoints require authentication via Cognito JWT tokens.

## Base URL

| Environment | Base URL |
|-------------|----------|
| Development | `https://api-dev.jobapp.example.com/v1` |
| Staging | `https://api-staging.jobapp.example.com/v1` |
| Production | `https://api.jobapp.example.com/v1` |

## Authentication

All requests must include a valid JWT token in the Authorization header:

```
Authorization: Bearer <cognito_id_token>
```

The user ID is extracted from the `sub` claim in the JWT token.

## Common Response Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (successful delete) |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (accessing another user's data) |
| 404 | Not Found |
| 409 | Conflict (version mismatch) |
| 429 | Too Many Requests |
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

## References

- [Architecture Overview](./ARCHITECTURE.md)
- [Data Model](./DATA_MODEL.md)
- [User Flows](../design/USER_FLOWS.md)
