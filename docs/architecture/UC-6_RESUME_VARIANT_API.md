# UC-6: Resume Variant Generation API Design

## Overview

Resume Variant Generation enables users to create tailored resume versions optimized for specific job applications. Variants are generated from the user's catalog (STAR entries, tech stack tags, themes) and can be customized based on job fit analysis results.

Unlike cover letters which are generated as freeform text, resume variants maintain a structured format with sections (Experience, Skills, Projects, Education) and allow granular control over which bullets appear in each section.

## Data Model

### Database Schema

```sql
-- Resume variant status
CREATE TYPE resume_variant_status AS ENUM ('draft', 'finalized');

-- Resume format/style
CREATE TYPE resume_format AS ENUM (
  'chronological',    -- Traditional reverse-chronological
  'functional',       -- Skills-focused, grouped by competency
  'hybrid'            -- Combination: skills summary + chronological experience
);

-- Section emphasis preference
CREATE TYPE section_emphasis AS ENUM (
  'experience_heavy',  -- Prioritize work experience
  'skills_heavy',      -- Prioritize technical skills
  'balanced'           -- Equal weight
);

CREATE TABLE resume_variants (
  id                    TEXT PRIMARY KEY,
  status                resume_variant_status NOT NULL DEFAULT 'draft',
  title                 TEXT NOT NULL,
  target_company        TEXT NOT NULL,
  target_role           TEXT NOT NULL,
  format                resume_format NOT NULL DEFAULT 'chronological',
  section_emphasis      section_emphasis NOT NULL DEFAULT 'balanced',
  
  -- Source references
  base_resume_id        TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  job_fit_analysis_id   TEXT,
  job_description_text  TEXT,
  job_description_url   TEXT,
  
  -- Selected content from catalog
  selected_bullets      JSONB NOT NULL DEFAULT '[]',  -- Array of {sectionId, bulletIds[]}
  selected_tech_tags    JSONB NOT NULL DEFAULT '[]',  -- Array of tag IDs
  selected_themes       JSONB NOT NULL DEFAULT '[]',  -- Array of theme slugs
  
  -- Section ordering and visibility
  section_order         JSONB NOT NULL DEFAULT '["summary","experience","skills","projects","education"]',
  hidden_sections       JSONB NOT NULL DEFAULT '[]',
  
  -- Generated content
  content               JSONB NOT NULL,  -- Structured resume content (see ContentStructure)
  
  -- Revision tracking
  revision_history      JSONB NOT NULL DEFAULT '[]',
  
  -- Timestamps and versioning
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_resume_variants_status ON resume_variants(status);
CREATE INDEX idx_resume_variants_company ON resume_variants(target_company);
CREATE INDEX idx_resume_variants_created ON resume_variants(created_at DESC);
```

### TypeScript Types

```typescript
interface ResumeVariant {
  id: string;                      // ULID
  status: 'draft' | 'finalized';
  title: string;                   // Auto-generated or user-provided
  targetCompany: string;
  targetRole: string;
  format: ResumeFormat;
  sectionEmphasis: SectionEmphasis;
  
  // Source references
  baseResumeId?: string;
  jobFitAnalysisId?: string;
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  
  // Selected content
  selectedBullets: SectionBulletSelection[];
  selectedTechTags: string[];
  selectedThemes: string[];
  
  // Section configuration
  sectionOrder: SectionType[];
  hiddenSections: SectionType[];
  
  // Generated content
  content: ResumeContent;
  
  // Revision tracking
  revisionHistory: RevisionEntry[];
  
  createdAt: string;               // ISO 8601
  updatedAt: string;               // ISO 8601
  version: number;
}

type ResumeFormat = 
  | 'chronological'     // Traditional reverse-chronological
  | 'functional'        // Skills-focused, grouped by competency
  | 'hybrid';           // Combination: skills summary + chronological

type SectionEmphasis =
  | 'experience_heavy'  // More space for work experience
  | 'skills_heavy'      // More space for technical skills
  | 'balanced';         // Equal distribution

type SectionType = 
  | 'summary'
  | 'experience'
  | 'skills'
  | 'projects'
  | 'education'
  | 'certifications';

interface SectionBulletSelection {
  sectionId: string;               // Experience entry ID or project ID
  bulletIds: string[];             // Quantified bullet IDs from catalog
  customBullets?: string[];        // User-added bullets (not from catalog)
}

interface ResumeContent {
  summary?: string;
  experience: ExperienceSection[];
  skills: SkillsSection;
  projects?: ProjectSection[];
  education?: EducationSection[];
  certifications?: string[];
}

interface ExperienceSection {
  id: string;
  company: string;
  role: string;
  location?: string;
  startDate: string;
  endDate?: string;                // Null = "Present"
  bullets: BulletContent[];
}

interface BulletContent {
  id: string;
  text: string;
  source: 'catalog' | 'custom';
  impactCategory?: string;
}

interface SkillsSection {
  categories: SkillCategory[];
}

interface SkillCategory {
  name: string;                    // e.g., "Languages", "Frameworks", "Cloud"
  skills: string[];
}

interface ProjectSection {
  id: string;
  name: string;
  description?: string;
  techStack: string[];
  bullets: BulletContent[];
}

interface EducationSection {
  institution: string;
  degree: string;
  field?: string;
  graduationDate?: string;
  gpa?: string;
  honors?: string[];
}

interface RevisionEntry {
  id: string;
  instructions: string;
  previousContent: ResumeContent;
  appliedAt: string;               // ISO 8601
}
```

---

## Endpoints

### Generate Resume Variant

```
POST /resume-variants/generate
```

Generates a new resume variant optimized for a specific job target.

**Request Body**:

```typescript
interface GenerateResumeVariantRequest {
  // Job context (at least one required)
  jobDescriptionText?: string;     // 50-50,000 characters
  jobDescriptionUrl?: string;      // Valid URL to job posting
  jobFitAnalysisId?: string;       // ID from prior /catalog/job-fit/analyze call
  
  // Target info (required if not using jobFitAnalysisId)
  targetCompany?: string;          // 1-200 characters
  targetRole?: string;             // 1-200 characters
  
  // Base resume (optional - uses latest if not specified)
  baseResumeId?: string;
  
  // Content selection
  selectedBullets?: SectionBulletSelection[];  // If omitted, AI selects based on job fit
  selectedTechTags?: string[];     // If omitted, derives from job fit analysis
  selectedThemes?: string[];       // Theme slugs to emphasize
  
  // Format preferences
  format?: ResumeFormat;           // Default: 'chronological'
  sectionEmphasis?: SectionEmphasis; // Default: 'balanced'
  sectionOrder?: SectionType[];    // Default: standard order
  hiddenSections?: SectionType[];  // Sections to exclude
  
  // Generation options
  maxBulletsPerRole?: number;      // Default: 5, max: 8
  includeProjects?: boolean;       // Default: true
  atsOptimized?: boolean;          // Default: true (ATS-friendly formatting)
  
  // Optional customization
  summaryInstructions?: string;    // Guidance for summary section, max 500 chars
}
```

**Validation Rules**:

- At least one of `jobDescriptionText`, `jobDescriptionUrl`, or `jobFitAnalysisId` required
- If `jobFitAnalysisId` provided, `targetCompany` and `targetRole` are derived from analysis
- Cannot combine `jobDescriptionText` and `jobDescriptionUrl` (conflict)
- `selectedBullets[].bulletIds` must reference existing quantified bullets
- `selectedTechTags` must reference existing tech stack tags
- `sectionOrder` must contain valid section types with no duplicates

**Response**: `201 Created`

```typescript
interface GenerateResumeVariantResponse {
  variant: ResumeVariant;
  
  // Generation metadata
  usedBullets: UsedBullet[];
  matchedTechTags: string[];
  matchedThemes: string[];
  atsScore?: number;               // 0-100, only if atsOptimized=true
  warnings: GenerationWarning[];
}

interface UsedBullet {
  id: string;
  rawText: string;
  section: string;                 // Where it was placed
  impactCategory: string;
  relevanceScore: number;          // 0-1, relevance to JD
}

interface GenerationWarning {
  code: string;
  message: string;
}
```

**Warning Codes**:

| Code | Description |
|------|-------------|
| `BULLET_LOW_RELEVANCE` | Selected bullet has low relevance to target role |
| `EXPERIENCE_GAP` | Significant gap detected in employment history |
| `SKILLS_MISMATCH` | Required skills from JD not found in catalog |
| `SENIORITY_MISMATCH` | Target role seniority differs from experience level |
| `SECTION_EMPTY` | A visible section has no content |
| `ATS_KEYWORD_LOW` | Low keyword density for ATS optimization |

**Example Request**:

```bash
curl -X POST "http://localhost:3000/api/resume-variants/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "jobFitAnalysisId": "01HXK5R3J7Q8N2M4P6W9Y1Z3D8",
    "format": "hybrid",
    "sectionEmphasis": "skills_heavy",
    "maxBulletsPerRole": 4,
    "atsOptimized": true,
    "summaryInstructions": "Emphasize cloud architecture and team leadership experience"
  }'
```

**Example Response**:

```json
{
  "variant": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3R1",
    "status": "draft",
    "title": "Resume - Senior Software Engineer at Acme Corp",
    "targetCompany": "Acme Corp",
    "targetRole": "Senior Software Engineer",
    "format": "hybrid",
    "sectionEmphasis": "skills_heavy",
    "selectedBullets": [
      {
        "sectionId": "exp_01HXK5R3J7Q8N2M4P6W9Y1Z3E1",
        "bulletIds": ["01HXK5R3J7Q8N2M4P6W9Y1Z3C7", "01HXK5R3J7Q8N2M4P6W9Y1Z3C8"]
      }
    ],
    "selectedTechTags": ["typescript", "react", "postgresql", "aws"],
    "selectedThemes": ["performance-optimization", "technical-leadership"],
    "sectionOrder": ["summary", "skills", "experience", "projects", "education"],
    "hiddenSections": [],
    "content": {
      "summary": "Senior Software Engineer with 8+ years of experience building scalable cloud architectures and leading high-performing teams. Proven track record of delivering 40% performance improvements and mentoring engineers across distributed systems.",
      "skills": {
        "categories": [
          {
            "name": "Languages",
            "skills": ["TypeScript", "JavaScript", "Python", "Go"]
          },
          {
            "name": "Frontend",
            "skills": ["React", "Next.js", "Tailwind CSS"]
          },
          {
            "name": "Backend & Cloud",
            "skills": ["Node.js", "PostgreSQL", "AWS", "Docker", "Kubernetes"]
          }
        ]
      },
      "experience": [
        {
          "id": "exp_01HXK5R3J7Q8N2M4P6W9Y1Z3E1",
          "company": "TechCorp Inc",
          "role": "Senior Software Engineer",
          "location": "San Francisco, CA",
          "startDate": "2021-03",
          "endDate": null,
          "bullets": [
            {
              "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
              "text": "Reduced API response times by 40% through query optimization and caching strategies, handling 10M+ daily requests",
              "source": "catalog",
              "impactCategory": "performance"
            },
            {
              "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C8",
              "text": "Led TypeScript migration across 200K LOC codebase, improving developer productivity by 25%",
              "source": "catalog",
              "impactCategory": "efficiency"
            }
          ]
        }
      ],
      "projects": [],
      "education": [
        {
          "institution": "University of California, Berkeley",
          "degree": "B.S.",
          "field": "Computer Science",
          "graduationDate": "2016"
        }
      ]
    },
    "revisionHistory": [],
    "createdAt": "2026-04-28T10:30:00.000Z",
    "updatedAt": "2026-04-28T10:30:00.000Z",
    "version": 1
  },
  "usedBullets": [
    {
      "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
      "rawText": "Reduced API response times by 40% through query optimization and caching",
      "section": "experience",
      "impactCategory": "performance",
      "relevanceScore": 0.92
    },
    {
      "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3C8",
      "rawText": "Led TypeScript migration improving developer productivity by 25%",
      "section": "experience",
      "impactCategory": "efficiency",
      "relevanceScore": 0.88
    }
  ],
  "matchedTechTags": ["typescript", "react", "postgresql"],
  "matchedThemes": ["performance-optimization", "technical-leadership"],
  "atsScore": 87,
  "warnings": []
}
```

---

### Revise Resume Variant

```
POST /resume-variants/{id}/revise
```

Revises an existing resume variant based on user instructions.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Resume variant ID (ULID) |

**Request Body**:

```typescript
interface ReviseResumeVariantRequest {
  instructions: string;            // 10-2,000 characters, revision guidance
  
  // Optional: update content selections
  selectedBullets?: SectionBulletSelection[];
  selectedTechTags?: string[];
  
  // Optional: update section configuration
  sectionOrder?: SectionType[];
  hiddenSections?: SectionType[];
  
  // Optional: update format preferences
  format?: ResumeFormat;
  sectionEmphasis?: SectionEmphasis;
  
  version: number;                 // Required for optimistic locking
}
```

**Response**: `200 OK`

```typescript
interface ReviseResumeVariantResponse {
  variant: ResumeVariant;          // Updated with new content
  
  changesApplied: string[];        // Summary of changes made
  usedBullets: UsedBullet[];
  atsScore?: number;
}
```

**Example Request**:

```bash
curl -X POST "http://localhost:3000/api/resume-variants/01HXK5R3J7Q8N2M4P6W9Y1Z3R1/revise" \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": "Add more emphasis on AWS experience. Move the cloud skills to the top of the skills section. Make the summary more concise.",
    "version": 1
  }'
```

**Example Response**:

```json
{
  "variant": {
    "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3R1",
    "status": "draft",
    "content": {
      "summary": "Cloud-focused Senior Engineer with 8+ years leading teams and delivering 40% performance gains across AWS infrastructure.",
      "skills": {
        "categories": [
          {
            "name": "Cloud & DevOps",
            "skills": ["AWS (EC2, Lambda, S3, RDS)", "Docker", "Kubernetes", "Terraform"]
          },
          {
            "name": "Languages",
            "skills": ["TypeScript", "JavaScript", "Python", "Go"]
          }
        ]
      }
    },
    "revisionHistory": [
      {
        "id": "01HXK5R3J7Q8N2M4P6W9Y1Z3V1",
        "instructions": "Add more emphasis on AWS experience. Move the cloud skills to the top of the skills section. Make the summary more concise.",
        "previousContent": { },
        "appliedAt": "2026-04-28T11:00:00.000Z"
      }
    ],
    "version": 2
  },
  "changesApplied": [
    "Reordered skills categories to prioritize Cloud & DevOps",
    "Expanded AWS skills with specific services",
    "Shortened summary from 45 to 22 words"
  ],
  "usedBullets": [],
  "atsScore": 89
}
```

---

### Suggest Bullets

```
POST /resume-variants/suggest-bullets
```

Returns AI-recommended bullets from the catalog for a given job context, without creating a variant.

**Request Body**:

```typescript
interface SuggestBulletsRequest {
  // Job context (at least one required)
  jobDescriptionText?: string;
  jobDescriptionUrl?: string;
  jobFitAnalysisId?: string;
  
  // Filtering options
  maxBulletsPerSection?: number;   // Default: 5
  impactCategories?: string[];     // Filter to specific impact types
  excludeBulletIds?: string[];     // Bullets to exclude from suggestions
}
```

**Response**: `200 OK`

```typescript
interface SuggestBulletsResponse {
  suggestions: BulletSuggestion[];
  totalCatalogBullets: number;
}

interface BulletSuggestion {
  bulletId: string;
  rawText: string;
  impactCategory: string;
  relevanceScore: number;          // 0-1
  matchedKeywords: string[];       // JD keywords this bullet matches
  suggestedSection: string;        // Recommended placement
  reasoning: string;               // Why this bullet was selected
}
```

**Example Response**:

```json
{
  "suggestions": [
    {
      "bulletId": "01HXK5R3J7Q8N2M4P6W9Y1Z3C7",
      "rawText": "Reduced API response times by 40% through query optimization and caching",
      "impactCategory": "performance",
      "relevanceScore": 0.92,
      "matchedKeywords": ["performance", "optimization", "API"],
      "suggestedSection": "experience",
      "reasoning": "Strong match for JD requirement: 'optimize system performance'"
    }
  ],
  "totalCatalogBullets": 24
}
```

---

### List Resume Variants

```
GET /resume-variants
```

Returns saved resume variants with search and filtering.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status: `draft`, `finalized` |
| `company` | string | No | Filter by target company (partial match) |
| `search` | string | No | Search in title, company, role |
| `format` | string | No | Filter by format: `chronological`, `functional`, `hybrid` |
| `limit` | number | No | Max results (default: 20, max: 100) |
| `cursor` | string | No | Pagination cursor |

**Response**: `200 OK`

```typescript
interface ListResumeVariantsResponse {
  variants: ResumeVariantSummary[];
  nextCursor?: string;
}

interface ResumeVariantSummary {
  id: string;
  status: 'draft' | 'finalized';
  title: string;
  targetCompany: string;
  targetRole: string;
  format: ResumeFormat;
  atsScore?: number;
  createdAt: string;
  updatedAt: string;
}
```

---

### Get Resume Variant

```
GET /resume-variants/{id}
```

Returns a single resume variant with full content.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Resume variant ID (ULID) |

**Response**: `200 OK`

```typescript
interface GetResumeVariantResponse {
  variant: ResumeVariant;
  usedBullets: UsedBullet[];
  baseResume?: {
    id: string;
    fileName: string;
  };
  jobFitAnalysis?: {
    id: string;
    recommendation: string;
  };
}
```

---

### Update Resume Variant

```
PATCH /resume-variants/{id}
```

Updates resume variant metadata (not content - use revise for that).

**Request Body**:

```typescript
interface UpdateResumeVariantRequest {
  title?: string;
  status?: 'draft' | 'finalized';
  version: number;                 // Required for optimistic locking
}
```

**Response**: `200 OK` - returns updated `ResumeVariant`

**Error**: `409 Conflict` if version doesn't match

---

### Delete Resume Variant

```
DELETE /resume-variants/{id}
```

Permanently deletes a resume variant.

**Response**: `204 No Content`

---

### Export Resume Variant

```
POST /resume-variants/{id}/export
```

Exports a resume variant to a downloadable document format.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Resume variant ID (ULID) |

**Request Body**:

```typescript
interface ExportResumeVariantRequest {
  format: 'pdf' | 'docx';
  
  // Template selection
  template?: 'modern' | 'classic' | 'minimal' | 'ats_optimized';  // Default: 'modern'
  
  // Header customization
  headerInfo: {
    name: string;                  // Required
    email?: string;
    phone?: string;
    linkedin?: string;
    github?: string;
    location?: string;
    portfolio?: string;
  };
  
  // Styling options
  fontFamily?: 'default' | 'serif' | 'modern';  // Default: 'default'
  fontSize?: 10 | 11 | 12;         // Default: 11
  margins?: 'normal' | 'narrow' | 'wide';  // Default: 'normal'
  
  // Page constraints
  targetPages?: 1 | 2;             // Attempts to fit content to page count
}
```

**Response**: `200 OK`

For direct download:

```
Content-Type: application/pdf (or application/vnd.openxmlformats-officedocument.wordprocessingml.document)
Content-Disposition: attachment; filename="resume-acme-corp-2026-04-28.pdf"

[binary file content]
```

**Alternative JSON Response** (if `Accept: application/json` header):

```typescript
interface ExportResumeVariantResponse {
  exportId: string;
  format: 'pdf' | 'docx';
  filename: string;
  fileSize: number;                // Bytes
  base64Content: string;           // Base64-encoded file
  pageCount: number;
  createdAt: string;
}
```

**Example Request**:

```bash
curl -X POST "http://localhost:3000/api/resume-variants/01HXK5R3J7Q8N2M4P6W9Y1Z3R1/export" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "pdf",
    "template": "ats_optimized",
    "headerInfo": {
      "name": "Alex Johnson",
      "email": "alex@example.com",
      "phone": "(555) 123-4567",
      "linkedin": "linkedin.com/in/alexjohnson",
      "location": "San Francisco, CA"
    },
    "targetPages": 1
  }' \
  -o resume.pdf
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VARIANT_NOT_FOUND` | 404 | Resume variant ID does not exist |
| `JOB_CONTEXT_REQUIRED` | 400 | No job description, URL, or analysis ID provided |
| `JOB_CONTEXT_CONFLICT` | 400 | Both job description text and URL provided |
| `TARGET_INFO_REQUIRED` | 400 | Company/role required when not using job fit analysis |
| `BULLET_NOT_FOUND` | 404 | One or more bullet IDs invalid |
| `TAG_NOT_FOUND` | 404 | One or more tech tag IDs invalid |
| `INVALID_SECTION_ORDER` | 400 | Section order contains invalid or duplicate sections |
| `REVISION_INSTRUCTIONS_REQUIRED` | 400 | Revise request missing instructions |
| `VARIANT_VERSION_CONFLICT` | 409 | Version mismatch during update |
| `EXPORT_FORMAT_INVALID` | 400 | Unsupported export format |
| `EXPORT_TEMPLATE_INVALID` | 400 | Unknown template name |
| `CATALOG_EMPTY` | 422 | Cannot generate without catalog data |
| `BASE_RESUME_NOT_FOUND` | 404 | Specified base resume does not exist |
| `PAGE_CONSTRAINT_FAILED` | 422 | Could not fit content to target page count |

**Error Response Example**:

```json
{
  "error": {
    "code": "BULLET_NOT_FOUND",
    "message": "One or more selected bullet IDs do not exist in your catalog",
    "details": {
      "invalidIds": ["01HXK5R3J7Q8N2M4P6W9INVALID"]
    }
  }
}
```

---

## Content Generation Constraints

The resume variant generation system enforces these constraints:

1. **No Fabrication**: Generated content only uses information from the user's catalog. Job titles, companies, dates, metrics, and achievements are never invented.

2. **Factual Accuracy**: Bullets are reproduced from the catalog with minor tailoring (verb tense, keyword incorporation) but no metric inflation or skill exaggeration.

3. **Date Integrity**: Employment dates and education dates are preserved exactly as stored in the base resume or catalog.

4. **Skills Verification**: Only tech stack tags present in the user's catalog appear in the Skills section. The system will not add skills the user hasn't claimed.

5. **ATS Optimization**: When `atsOptimized: true`:
   - Uses standard section headers (Experience, Education, Skills)
   - Avoids tables, columns, graphics, headers/footers
   - Incorporates JD keywords naturally into bullet text
   - Uses standard fonts and formatting

6. **Page Constraints**: When `targetPages` is specified:
   - Prioritizes high-relevance bullets
   - May reduce bullets per role
   - Will warn if constraints cannot be met without omitting critical content

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/resume-variants/generate` | 20 requests | 1 minute |
| `/resume-variants/suggest-bullets` | 30 requests | 1 minute |
| `/resume-variants/:id/revise` | 30 requests | 1 minute |
| `/resume-variants/:id/export` | 10 requests | 1 minute |

Rate limits are per session. When exceeded, responses return `429 Too Many Requests` with `Retry-After` header.

---

## Drizzle ORM Schema Addition

```typescript
// packages/api/src/db/schema.ts

export const resumeVariantStatusEnum = pgEnum('resume_variant_status', ['draft', 'finalized']);
export const resumeFormatEnum = pgEnum('resume_format', ['chronological', 'functional', 'hybrid']);
export const sectionEmphasisEnum = pgEnum('section_emphasis', ['experience_heavy', 'skills_heavy', 'balanced']);

export const resumeVariants = pgTable('resume_variants', {
  id: text('id').primaryKey(),
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
  selectedBullets: jsonb('selected_bullets').$type<SectionBulletSelection[]>().notNull().default([]),
  selectedTechTags: jsonb('selected_tech_tags').$type<string[]>().notNull().default([]),
  selectedThemes: jsonb('selected_themes').$type<string[]>().notNull().default([]),
  sectionOrder: jsonb('section_order').$type<string[]>().notNull().default(['summary', 'experience', 'skills', 'projects', 'education']),
  hiddenSections: jsonb('hidden_sections').$type<string[]>().notNull().default([]),
  content: jsonb('content').$type<ResumeContent>().notNull(),
  revisionHistory: jsonb('revision_history').$type<RevisionEntry[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export type ResumeVariant = typeof resumeVariants.$inferSelect;
export type NewResumeVariant = typeof resumeVariants.$inferInsert;
```

---

## Integration Points

### Job Fit Analysis (UC-3)

When `jobFitAnalysisId` is provided:
- `targetCompany` and `targetRole` are derived from `parsedJd.roleTitle` and the analysis context
- `strongMatches` inform which tech tags to highlight
- `recommendedStarEntries` seed the bullet selection
- `gaps` may be noted in warnings but content is not fabricated

### Catalog (UC-2)

- `quantifiedBullets` table provides the bullet content pool
- `techStackTags` table provides verified skills
- `recurringThemes` with `isCoreStrength=true` are prioritized

### Cover Letters (UC-4)

- Resume variants can share `jobFitAnalysisId` with cover letters
- Consistent `selectedStarEntryIds` across both documents ensures narrative alignment

---

## References

- [API Contracts](./API_CONTRACTS.md)
- [Data Model](./DATA_MODEL.md)
- [UC-3 Job Fit Analysis](./API_CONTRACTS.md#job-fit-analysis-uc-3)
- [UC-4 Cover Letter Generation](./API_CONTRACTS.md#cover-letter-generation-uc-4)
