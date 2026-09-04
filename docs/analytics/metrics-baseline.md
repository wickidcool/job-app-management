# Careerpin — Metrics Baseline

**Version:** 1.0  
**Date:** 2026-04-19  
**Status:** Instrumentation shipped — resume-upload & export event taxonomy is live in code (WIC-814/815/817, merged 2026-08-04; `packages/api/src/services/analytics.service.ts`, `packages/web/src/services/analytics.ts`). Production capture is inactive until DevOps sets `ANALYTICS_SINK=posthog` + PostHog creds (WIC-821).

---

## 1. Product Context

Careerpin enables users to upload resumes (PDF or DOCX), automatically parse and reformat them into STAR-format markdown, and manage their exports. The three core user flows covered by this document are:

1. **Resume Upload & Parsing** — file upload, text extraction, STAR generation
2. **Export Viewing** — browsing and consuming generated exports
3. **User Engagement & Retention** — session-level and longitudinal signals

---

## 2. KPI Definitions

### 2.1 Resume Upload & Parsing

| KPI                        | Definition                                            | Unit  | Healthy Range |
| -------------------------- | ----------------------------------------------------- | ----- | ------------- |
| Upload Success Rate        | `successful_uploads / upload_attempts`                | %     | ≥ 95%         |
| Parse Success Rate         | `resumes_with_sections_detected / successful_uploads` | %     | ≥ 90%         |
| Avg. Processing Time       | Mean time from file received to export generated      | ms    | ≤ 3,000 ms    |
| P95 Processing Time        | 95th-percentile processing time                       | ms    | ≤ 8,000 ms    |
| Avg. Sections Detected     | Mean number of parsed sections per resume             | count | 4–8           |
| Avg. Bullets per Section   | Mean bullets extracted per section                    | count | 3–10          |
| Avg. Extracted Text Length | Mean char count of raw text per resume                | chars | 2,000–8,000   |
| Validation Error Rate      | `validation_failures / upload_attempts`               | %     | ≤ 5%          |

### 2.2 Export & Output Quality

| KPI                    | Definition                                 | Unit  | Healthy Range              |
| ---------------------- | ------------------------------------------ | ----- | -------------------------- |
| Export Generation Rate | `exports_generated / successful_uploads`   | %     | ~100% (1:1 auto-generated) |
| Avg. Export Size       | Mean char count of generated STAR markdown | chars | 1,500–6,000                |
| Export View Rate       | `export_views / resumes_with_exports`      | %     | ≥ 50%                      |

### 2.3 User Engagement & Retention

| KPI                              | Definition                                         | Unit  | Healthy Range |
| -------------------------------- | -------------------------------------------------- | ----- | ------------- |
| Uploads per Active User (weekly) | Mean uploads per DAU over 7-day window             | count | ≥ 1           |
| Upload Funnel Completion Rate    | Users who complete upload / users who start upload | %     | ≥ 80%         |
| Resume Manager Visit Rate        | Sessions including manager page / total sessions   | %     | ≥ 40%         |
| Return Upload Rate               | Users who upload ≥ 2 resumes within 30 days        | %     | ≥ 30%         |

---

## 3. Event Taxonomy

### 3.1 Resume Upload Flow

#### `resume_upload_started`

Fired when the user initiates a file selection or drag-and-drop.

| Property     | Type                             | Description                |
| ------------ | -------------------------------- | -------------------------- |
| `session_id` | string                           | Current session identifier |
| `source`     | `"file_picker"` \| `"drag_drop"` | How the file was selected  |

#### `resume_upload_validation_failed`

Fired when client-side validation rejects the file before upload.

| Property          | Type                                  | Description                |
| ----------------- | ------------------------------------- | -------------------------- |
| `session_id`      | string                                |                            |
| `error_type`      | `"invalid_type"` \| `"size_exceeded"` | Reason for rejection       |
| `file_mime_type`  | string                                | MIME type of rejected file |
| `file_size_bytes` | number                                | File size in bytes         |

#### `resume_upload_submitted`

Fired when the XHR upload begins (file passes validation).

| Property          | Type                | Description                                                     |
| ----------------- | ------------------- | --------------------------------------------------------------- |
| `session_id`      | string              |                                                                 |
| `upload_id`       | string              | Per-upload ULID shared with the terminal leg — see note below    |
| `file_type`       | `"pdf"` \| `"docx"` | Uploaded file type                                              |
| `file_size_bytes` | number              |                                                                 |

> **`upload_id` is the join key across all three upload legs** (`submitted` → `completed` \|
> `failed`), generated once per `uploadResume()` call. `session_id` is one-to-many over uploads, and
> `resume_id` / `export_id` are generated *by* the work that may fail, so they can never appear on
> `_submitted` or `_failed`. Without `upload_id` the gap metric below is valid only in aggregate — a
> session that uploads twice and fails once nets out to "fine" — and an upload spanning a window
> boundary is miscounted. With it, §6.6 Query 2 resolves per upload. Emitting it does **not** make
> `_failed` reliable and does not retire the gap metric; it makes the gap exactly joinable
> (WIC-1487).

#### `resume_upload_completed`

Fired on successful server response (upload + parse + export all done).

| Property               | Type                | Description                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id`           | string              |                                                                                                                                                                                                                                                                      |
| `upload_id`            | string              | Per-upload ULID shared with `resume_upload_submitted` — see the note under that event                                                                                                                                                                                |
| `resume_id`            | string              | Assigned resume ULID                                                                                                                                                                                                                                                 |
| `export_id`            | string              | Auto-generated export ULID                                                                                                                                                                                                                                           |
| `file_type`            | `"pdf"` \| `"docx"` |                                                                                                                                                                                                                                                                      |
| `file_size_bytes`      | number              |                                                                                                                                                                                                                                                                      |
| `processing_time_ms`   | number              | Server-side time from receipt to export                                                                                                                                                                                                                              |
| `sections_detected`    | number              | Number of parsed sections                                                                                                                                                                                                                                            |
| `bullets_total`        | number              | Total bullet count across all sections                                                                                                                                                                                                                               |
| `extracted_char_count` | number              | Raw text character count                                                                                                                                                                                                                                             |
| `is_duplicate`         | boolean             | `true` when the upload short-circuited on duplicate content (content-hash match) instead of running the full extract→parse→export pipeline. Filter `is_duplicate = false` for the Avg / P95 Processing Time KPIs (§2.1); keep all rows for funnel / completion KPIs. |

#### `resume_upload_failed`

Fired when the upload or server-side processing returns an error.

| Property      | Type                                                                 | Description                           |
| ------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `session_id`  | string                                                               |                                       |
| `upload_id`   | string                                                               | Per-upload ULID shared with `resume_upload_submitted` |
| `file_type`   | `"pdf"` \| `"docx"` \| `"unknown"`                                   |                                       |
| `error_code`  | string                                                               | HTTP status or application error code |
| `error_stage` | `"upload"` \| `"extraction"` \| `"parsing"` \| `"export_generation"` | Where the failure occurred            |

> **⚠ This event is DIAGNOSTIC ONLY — never the count of failures.** It is delivered by a `fetch`,
> which is a Cloudflare subrequest, from the catch block in `resume.service.ts`. When an upload fails
> *because* the Worker exhausted its subrequest budget, this capture is silently dropped — so the
> event goes missing in a way that is **correlated with the incident**, and a panel built on it reads
> toward 0 during a real outage. Measured in prod 2026-08-26: a real authenticated upload returned
> 500 and emitted **no** `resume_upload_failed` at all (WIC-967 / WIC-1386 / WIC-1387).
>
> Count failures from the **gap** instead — a `resume_upload_submitted` with no matching terminal
> event *is* a failure; `_submitted` is emitted before any dependency work and survives the
> pressure. Read this event only for `error_code` / `error_stage` attribution, as a lower bound and a
> biased sample. **Do not "fix" delivery with `ctx.waitUntil()`** — the subrequest cap is per
> *invocation*, so a deferred `fetch` is charged to the same exhausted budget; only a Tail Worker or
> Logpush is genuinely out-of-band. Full rule, live evidence, alert query and known biases:
> `dashboard-spec.md` §6 (WIC-1476 / ADR-007 §4).

#### `resume_upload_cta_clicked`

Fired when user clicks "View Details" or "Upload New" after a completed upload.

| Property     | Type                               | Description              |
| ------------ | ---------------------------------- | ------------------------ |
| `session_id` | string                             |                          |
| `resume_id`  | string                             |                          |
| `cta`        | `"view_details"` \| `"upload_new"` | Which button was clicked |

---

### 3.2 Resume Manager Flow

#### `resume_manager_viewed`

Fired on page load of the Resume Manager.

| Property       | Type   | Description             |
| -------------- | ------ | ----------------------- |
| `session_id`   | string |                         |
| `resume_count` | number | Number of resumes shown |

#### `resume_exports_link_clicked`

Fired when user clicks "View Exports" for a resume.

| Property           | Type                | Description |
| ------------------ | ------------------- | ----------- |
| `session_id`       | string              |             |
| `resume_id`        | string              |             |
| `resume_file_type` | `"pdf"` \| `"docx"` |             |

---

### 3.3 Export Flow

#### `export_viewed`

Fired when a specific export is opened/viewed.

| Property      | Type              | Description |
| ------------- | ----------------- | ----------- |
| `session_id`  | string            |             |
| `resume_id`   | string            |             |
| `export_id`   | string            |             |
| `export_type` | `"star_markdown"` |             |

---

## 4. Baseline Targets

The following thresholds are suggested for initial launch. They should be revisited after 30 days of production traffic.

### Upload Health

| Signal                | Warning Threshold | Critical Threshold |
| --------------------- | ----------------- | ------------------ |
| Upload Success Rate   | < 97%             | < 93%              |
| Parse Success Rate    | < 85%             | < 75%              |
| P95 Processing Time   | > 6,000 ms        | > 12,000 ms        |
| Validation Error Rate | > 8%              | > 15%              |

### Engagement

| Signal                   | Warning Threshold | Action                                                |
| ------------------------ | ----------------- | ----------------------------------------------------- |
| Upload Funnel Completion | < 70%             | Investigate abandonment points; check for UX friction |
| Export View Rate         | < 30%             | Consider in-app prompts to surface exports            |
| Return Upload Rate       | < 15% in 30 days  | Evaluate onboarding and value communication           |

---

## 5. Instrumentation Notes for Backend Developer

- **Server-side events** (`resume_upload_completed`, `resume_upload_failed`) should be emitted from `packages/api/src/services/resume.service.ts` after the export generation step. The `processing_time_ms` field should be measured from file buffer receipt to export write completion.
- **`error_stage`** on `resume_upload_failed` requires try/catch segmentation in the pipeline: separate catches for extraction (pdf-parse / mammoth), section parsing, and export generation.
- **Client-side events** (`resume_upload_started`, `resume_upload_validation_failed`, `resume_upload_cta_clicked`) should be added to `packages/web/src/pages/ResumeUpload.tsx` and the upload component at `packages/web/src/components/ResumeUpload.tsx`.
- **Session IDs** should be generated per browser session and propagated through both client and API calls.
- All events should be sent to the analytics pipeline via a thin wrapper so the underlying provider can be swapped without touching instrumentation callsites.

---

## 6. Open Questions

- [x] What analytics provider will be used? → **PostHog** (decided in WIC-814; see §7).
- [ ] Should `resume_id` be hashed/anonymized in analytics events? (Deferred — currently sent raw; the wrapper is the single chokepoint if hashing is later required.)
- [ ] Are application-status transitions (`saved → applied → interview → offer`) in scope for this baseline or a follow-on doc?
- [ ] Who owns the dashboard/alerting setup once events are flowing? (Data Analyst owns dashboards per WIC-814.)

---

## 7. Instrumentation Status (WIC-814)

**Chosen sink: PostHog.** Rationale: its HTTP capture API works from Cloudflare
Workers over `fetch` (no Node-only SDK), and its funnels/retention/trends map
directly onto the KPIs in §2. It is swappable via a thin wrapper, so the decision
is reversible without touching callsites.

- **Wrapper:** `packages/api/src/services/analytics.service.ts` — `track(event, props, sessionId)`.
  Sink selected by `ANALYTICS_SINK` env var (`noop` default | `console` | `posthog`);
  PostHog needs `POSTHOG_API_KEY` (+ optional `POSTHOG_HOST`). `track()` never throws.
- **Server-side events (done, this ticket):** `resume_upload_submitted`,
  `resume_upload_completed`, `resume_upload_failed` — emitted from `resume.service.ts`.
  `session_id` is propagated from the client via the `X-Session-Id` request header.
- **Client-side events (6):** delegated to Frontend Developer (child issue of WIC-814).
- **Prop naming note:** the completed event's raw-text length property is
  `extracted_char_count` (matching §3.1), not `extracted_text_length`. Dashboards
  should key on the §3 names.
- **Default is `noop`** so nothing emits until prod is deliberately wired
  (`ANALYTICS_SINK=posthog`), per the "build now, emit when prod is live" sequencing.
