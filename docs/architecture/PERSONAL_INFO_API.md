# Personal Information — API Contract & Database Schema

## Overview

Personal information stores the user's profile data (name, contact info, professional links, summary) that is reused across job applications, cover letters, resume exports, and outreach messages.

## Database Schema

### Schema Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         personal_info                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ PK │ id                  │ TEXT         │ ULID primary key              │
│    │ user_id             │ UUID         │ nullable (single-user mode)   │
│    │ first_name          │ TEXT         │ NOT NULL                      │
│    │ last_name           │ TEXT         │ NOT NULL                      │
│    │ email               │ TEXT         │ NOT NULL                      │
│    │ phone               │ TEXT         │ nullable                      │
│    │ address_line1       │ TEXT         │ nullable                      │
│    │ address_line2       │ TEXT         │ nullable                      │
│    │ city                │ TEXT         │ nullable                      │
│    │ state               │ TEXT         │ nullable                      │
│    │ postal_code         │ TEXT         │ nullable                      │
│    │ country             │ TEXT         │ nullable                      │
│    │ linkedin_url        │ TEXT         │ nullable                      │
│    │ github_url          │ TEXT         │ nullable                      │
│    │ portfolio_url       │ TEXT         │ nullable                      │
│    │ website_url         │ TEXT         │ nullable                      │
│    │ professional_summary│ TEXT         │ nullable                      │
│    │ headline            │ TEXT         │ nullable (e.g., "Sr. SWE")    │
│    │ created_at          │ TIMESTAMPTZ  │ NOT NULL, default now()       │
│    │ updated_at          │ TIMESTAMPTZ  │ NOT NULL, default now()       │
│    │ version             │ INTEGER      │ NOT NULL, default 1           │
└─────────────────────────────────────────────────────────────────────────┘
```

One record per user (UNIQUE constraint on `user_id`).

### SQL Schema

```sql
CREATE TABLE personal_info (
  id                   TEXT PRIMARY KEY,
  user_id              UUID UNIQUE,            -- NULL for single-user, UNIQUE for multi-user
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  phone                TEXT,
  address_line1        TEXT,
  address_line2        TEXT,
  city                 TEXT,
  state                TEXT,
  postal_code          TEXT,
  country              TEXT,
  linkedin_url         TEXT,
  github_url           TEXT,
  portfolio_url        TEXT,
  website_url          TEXT,
  professional_summary TEXT,
  headline             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version              INTEGER NOT NULL DEFAULT 1
);

-- Trigger for auto-updating updated_at
CREATE TRIGGER personal_info_updated_at
  BEFORE UPDATE ON personal_info
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### Drizzle ORM Schema

```typescript
// packages/api/src/db/schema.ts (additions)

export const personalInfo = pgTable('personal_info', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').unique(),
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
```

---

## API Contract

### Data Model

```typescript
interface PersonalInfo {
  id: string;                    // ULID
  firstName: string;             // 1-100 chars
  lastName: string;              // 1-100 chars
  email: string;                 // Valid email
  phone?: string;                // 1-30 chars, any format
  addressLine1?: string;         // 1-200 chars
  addressLine2?: string;         // 1-200 chars
  city?: string;                 // 1-100 chars
  state?: string;                // 1-100 chars
  postalCode?: string;           // 1-20 chars
  country?: string;              // 1-100 chars
  linkedinUrl?: string;          // Valid URL
  githubUrl?: string;            // Valid URL
  portfolioUrl?: string;         // Valid URL
  websiteUrl?: string;           // Valid URL
  professionalSummary?: string;  // 1-2000 chars
  headline?: string;             // 1-100 chars (e.g., "Senior Software Engineer")
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  version: number;
}
```

---

### Get Personal Info

```
GET /personal-info
```

Returns the user's personal information. Creates a default record if none exists.

**Response**: `200 OK`

```typescript
interface GetPersonalInfoResponse {
  personalInfo: PersonalInfo;
  isComplete: boolean;           // true if firstName, lastName, email all populated
  completionPercentage: number;  // 0-100 based on filled fields
}
```

**Example Response**:

```json
{
  "personalInfo": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3I1",
    "firstName": "Alex",
    "lastName": "Johnson",
    "email": "alex@example.com",
    "phone": "(555) 123-4567",
    "city": "San Francisco",
    "state": "CA",
    "country": "USA",
    "linkedinUrl": "https://linkedin.com/in/alexjohnson",
    "githubUrl": "https://github.com/alexj",
    "headline": "Senior Software Engineer",
    "professionalSummary": "Experienced software engineer with 8+ years...",
    "createdAt": "2026-04-20T10:00:00.000Z",
    "updatedAt": "2026-05-01T14:30:00.000Z",
    "version": 3
  },
  "isComplete": true,
  "completionPercentage": 75
}
```

---

### Update Personal Info

```
PATCH /personal-info
```

Updates the user's personal information. Creates a record if none exists (upsert behavior).

**Request Body**:

```typescript
interface UpdatePersonalInfoRequest {
  firstName?: string;            // 1-100 chars
  lastName?: string;             // 1-100 chars
  email?: string;                // Valid email
  phone?: string | null;         // null to clear
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;   // Valid URL or null
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  professionalSummary?: string | null;
  headline?: string | null;
  version?: number;              // Required if updating existing record
}
```

**Response**: `200 OK`

```typescript
interface UpdatePersonalInfoResponse {
  personalInfo: PersonalInfo;
  isComplete: boolean;
  completionPercentage: number;
}
```

**Error Cases**:

- `400 Bad Request` with code `INVALID_EMAIL` if email format invalid
- `400 Bad Request` with code `INVALID_URL` if URL format invalid
- `409 Conflict` if version doesn't match

**Example Request**:

```bash
curl -X PATCH "http://localhost:3000/api/personal-info" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Alex",
    "lastName": "Johnson",
    "email": "alex@example.com",
    "phone": "(555) 123-4567",
    "linkedinUrl": "https://linkedin.com/in/alexjohnson",
    "headline": "Senior Software Engineer",
    "version": 2
  }'
```

---

### Delete Personal Info

```
DELETE /personal-info
```

Resets personal information to empty state (soft reset - keeps the record with required fields cleared).

**Response**: `200 OK`

```typescript
interface DeletePersonalInfoResponse {
  personalInfo: PersonalInfo;    // Reset to defaults with only id/timestamps
}
```

---

### Export Contact Card (vCard)

```
GET /personal-info/export/vcard
```

Exports personal information as a downloadable vCard (.vcf) file.

**Response**: `200 OK`

```
Content-Type: text/vcard
Content-Disposition: attachment; filename="alex-johnson.vcf"

BEGIN:VCARD
VERSION:3.0
N:Johnson;Alex
FN:Alex Johnson
EMAIL:alex@example.com
TEL:(555) 123-4567
URL:https://linkedin.com/in/alexjohnson
END:VCARD
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `PERSONAL_INFO_NOT_FOUND` | 404 | Personal info record does not exist |
| `INVALID_EMAIL` | 400 | Email format invalid |
| `INVALID_URL` | 400 | URL format invalid (linkedinUrl, githubUrl, etc.) |
| `PERSONAL_INFO_VERSION_CONFLICT` | 409 | Version mismatch during update |
| `FIELD_TOO_LONG` | 400 | Field exceeds maximum length |

---

## Validation Rules (Zod Schema)

```typescript
// packages/api/src/routes/personal-info.ts

import { z } from 'zod';

const urlSchema = z.string().url().max(500).nullable().optional();

export const updatePersonalInfoSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().min(1).max(30).nullable().optional(),
  addressLine1: z.string().min(1).max(200).nullable().optional(),
  addressLine2: z.string().min(1).max(200).nullable().optional(),
  city: z.string().min(1).max(100).nullable().optional(),
  state: z.string().min(1).max(100).nullable().optional(),
  postalCode: z.string().min(1).max(20).nullable().optional(),
  country: z.string().min(1).max(100).nullable().optional(),
  linkedinUrl: urlSchema,
  githubUrl: urlSchema,
  portfolioUrl: urlSchema,
  websiteUrl: urlSchema,
  professionalSummary: z.string().min(1).max(2000).nullable().optional(),
  headline: z.string().min(1).max(100).nullable().optional(),
  version: z.number().int().positive().optional(),
});
```

---

## Completion Calculation

```typescript
function calculateCompletion(info: PersonalInfo): {
  isComplete: boolean;
  completionPercentage: number;
} {
  const requiredFields = ['firstName', 'lastName', 'email'];
  const optionalFields = [
    'phone', 'city', 'state', 'country',
    'linkedinUrl', 'githubUrl', 'headline', 'professionalSummary'
  ];
  
  const requiredFilled = requiredFields.filter(f => info[f]).length;
  const optionalFilled = optionalFields.filter(f => info[f]).length;
  
  const isComplete = requiredFilled === requiredFields.length;
  const completionPercentage = Math.round(
    ((requiredFilled + optionalFilled) / 
     (requiredFields.length + optionalFields.length)) * 100
  );
  
  return { isComplete, completionPercentage };
}
```

---

## Integration Points

| Consumer | Usage |
|----------|-------|
| Cover Letter Export | Uses `firstName`, `lastName`, `email`, `phone`, `linkedinUrl` for document header |
| Resume Variant Export | Uses full contact info for resume header section |
| Outreach Messages | Signs messages with `firstName` + `lastName` |
| Onboarding Flow | Collects personal info during initial setup |

---

## Migration File

```sql
-- migrations/0012_create_personal_info.sql

CREATE TABLE personal_info (
  id                   TEXT PRIMARY KEY,
  user_id              UUID UNIQUE,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  phone                TEXT,
  address_line1        TEXT,
  address_line2        TEXT,
  city                 TEXT,
  state                TEXT,
  postal_code          TEXT,
  country              TEXT,
  linkedin_url         TEXT,
  github_url           TEXT,
  portfolio_url        TEXT,
  website_url          TEXT,
  professional_summary TEXT,
  headline             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version              INTEGER NOT NULL DEFAULT 1
);

CREATE TRIGGER personal_info_updated_at
  BEFORE UPDATE ON personal_info
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

---

## TypeScript SDK Types

```typescript
// packages/web/src/types/personalInfo.ts

export interface PersonalInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  websiteUrl?: string;
  professionalSummary?: string;
  headline?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface GetPersonalInfoResponse {
  personalInfo: PersonalInfo;
  isComplete: boolean;
  completionPercentage: number;
}

export interface UpdatePersonalInfoRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  professionalSummary?: string | null;
  headline?: string | null;
  version?: number;
}
```

---

## References

- [Architecture Overview](./ARCHITECTURE.md)
- [API Contracts](./API_CONTRACTS.md)
- [Data Model](./DATA_MODEL.md)
