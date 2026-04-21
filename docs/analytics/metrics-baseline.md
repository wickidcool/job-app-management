# Job Application Manager — Metrics Baseline

**Version:** 1.0  
**Date:** 2026-04-19  
**Status:** Draft — pending Backend Developer instrumentation handoff

---

## 1. Product Context

The Job Application Manager enables users to upload resumes (PDF or DOCX), automatically parse and reformat them into STAR-format markdown, and manage their exports. The three core user flows covered by this document are:

1. **Resume Upload & Parsing** — file upload, text extraction, STAR generation
2. **Export Viewing** — browsing and consuming generated exports
3. **User Engagement & Retention** — session-level and longitudinal signals

---

## 2. KPI Definitions

### 2.1 Resume Upload & Parsing

| KPI | Definition | Unit | Healthy Range |
|-----|-----------|------|---------------|
| Upload Success Rate | `successful_uploads / upload_attempts` | % | ≥ 95% |
| Parse Success Rate | `resumes_with_sections_detected / successful_uploads` | % | ≥ 90% |
| Avg. Processing Time | Mean time from file received to export generated | ms | ≤ 3,000 ms |
| P95 Processing Time | 95th-percentile processing time | ms | ≤ 8,000 ms |
| Avg. Sections Detected | Mean number of parsed sections per resume | count | 4–8 |
| Avg. Bullets per Section | Mean bullets extracted per section | count | 3–10 |
| Avg. Extracted Text Length | Mean char count of raw text per resume | chars | 2,000–8,000 |
| Validation Error Rate | `validation_failures / upload_attempts` | % | ≤ 5% |

### 2.2 Export & Output Quality

| KPI | Definition | Unit | Healthy Range |
|-----|-----------|------|---------------|
| Export Generation Rate | `exports_generated / successful_uploads` | % | ~100% (1:1 auto-generated) |
| Avg. Export Size | Mean char count of generated STAR markdown | chars | 1,500–6,000 |
| Export View Rate | `export_views / resumes_with_exports` | % | ≥ 50% |

### 2.3 User Engagement & Retention

| KPI | Definition | Unit | Healthy Range |
|-----|-----------|------|---------------|
| Uploads per Active User (weekly) | Mean uploads per DAU over 7-day window | count | ≥ 1 |
| Upload Funnel Completion Rate | Users who complete upload / users who start upload | % | ≥ 80% |
| Resume Manager Visit Rate | Sessions including manager page / total sessions | % | ≥ 40% |
| Return Upload Rate | Users who upload ≥ 2 resumes within 30 days | % | ≥ 30% |

---

## 3. Event Taxonomy

### 3.1 Resume Upload Flow

#### `resume_upload_started`
Fired when the user initiates a file selection or drag-and-drop.

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | Current session identifier |
| `source` | `"file_picker"` \| `"drag_drop"` | How the file was selected |

#### `resume_upload_validation_failed`
Fired when client-side validation rejects the file before upload.

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `error_type` | `"invalid_type"` \| `"size_exceeded"` | Reason for rejection |
| `file_mime_type` | string | MIME type of rejected file |
| `file_size_bytes` | number | File size in bytes |

#### `resume_upload_submitted`
Fired when the XHR upload begins (file passes validation).

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `file_type` | `"pdf"` \| `"docx"` | Uploaded file type |
| `file_size_bytes` | number | |

#### `resume_upload_completed`
Fired on successful server response (upload + parse + export all done).

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `resume_id` | string | Assigned resume ULID |
| `export_id` | string | Auto-generated export ULID |
| `file_type` | `"pdf"` \| `"docx"` | |
| `file_size_bytes` | number | |
| `processing_time_ms` | number | Server-side time from receipt to export |
| `sections_detected` | number | Number of parsed sections |
| `bullets_total` | number | Total bullet count across all sections |
| `extracted_char_count` | number | Raw text character count |

#### `resume_upload_failed`
Fired when the upload or server-side processing returns an error.

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `file_type` | `"pdf"` \| `"docx"` \| `"unknown"` | |
| `error_code` | string | HTTP status or application error code |
| `error_stage` | `"upload"` \| `"extraction"` \| `"parsing"` \| `"export_generation"` | Where the failure occurred |

#### `resume_upload_cta_clicked`
Fired when user clicks "View Details" or "Upload New" after a completed upload.

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `resume_id` | string | |
| `cta` | `"view_details"` \| `"upload_new"` | Which button was clicked |

---

### 3.2 Resume Manager Flow

#### `resume_manager_viewed`
Fired on page load of the Resume Manager.

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `resume_count` | number | Number of resumes shown |

#### `resume_exports_link_clicked`
Fired when user clicks "View Exports" for a resume.

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `resume_id` | string | |
| `resume_file_type` | `"pdf"` \| `"docx"` | |

---

### 3.3 Export Flow

#### `export_viewed`
Fired when a specific export is opened/viewed.

| Property | Type | Description |
|----------|------|-------------|
| `session_id` | string | |
| `resume_id` | string | |
| `export_id` | string | |
| `export_type` | `"star_markdown"` | |

---

## 4. Baseline Targets

The following thresholds are suggested for initial launch. They should be revisited after 30 days of production traffic.

### Upload Health

| Signal | Warning Threshold | Critical Threshold |
|--------|------------------|--------------------|
| Upload Success Rate | < 97% | < 93% |
| Parse Success Rate | < 85% | < 75% |
| P95 Processing Time | > 6,000 ms | > 12,000 ms |
| Validation Error Rate | > 8% | > 15% |

### Engagement

| Signal | Warning Threshold | Action |
|--------|------------------|--------|
| Upload Funnel Completion | < 70% | Investigate abandonment points; check for UX friction |
| Export View Rate | < 30% | Consider in-app prompts to surface exports |
| Return Upload Rate | < 15% in 30 days | Evaluate onboarding and value communication |

---

## 5. Instrumentation Notes for Backend Developer

- **Server-side events** (`resume_upload_completed`, `resume_upload_failed`) should be emitted from `packages/api/src/services/resume.service.ts` after the export generation step. The `processing_time_ms` field should be measured from file buffer receipt to export write completion.
- **`error_stage`** on `resume_upload_failed` requires try/catch segmentation in the pipeline: separate catches for extraction (pdf-parse / mammoth), section parsing, and export generation.
- **Client-side events** (`resume_upload_started`, `resume_upload_validation_failed`, `resume_upload_cta_clicked`) should be added to `packages/web/src/pages/ResumeUpload.tsx` and the upload component at `packages/web/src/components/ResumeUpload.tsx`.
- **Session IDs** should be generated per browser session and propagated through both client and API calls.
- All events should be sent to the analytics pipeline via a thin wrapper so the underlying provider can be swapped without touching instrumentation callsites.

---

## 6. Open Questions

- [ ] What analytics provider will be used? (e.g., Segment, Mixpanel, PostHog, custom pipeline)
- [ ] Should `resume_id` be hashed/anonymized in analytics events?
- [ ] Are application-status transitions (`saved → applied → interview → offer`) in scope for this baseline or a follow-on doc?
- [ ] Who owns the dashboard/alerting setup once events are flowing?
