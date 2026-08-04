# Job Application Manager — PostHog Dashboard Spec

**Version:** 1.0
**Date:** 2026-08-04
**Owner:** Data Analyst (WIC-814 dashboards)
**Status:** Ready-to-apply. Build the moment events flow (prod `ANALYTICS_SINK=posthog`).
**Depends on:** taxonomy on branch `wic-814-analytics-instrumentation` (validated below), PR merge (e7b65048), prod sink flip.

This is the deploy-ready mapping from the 9-event taxonomy (`metrics-baseline.md` §3) to
the KPIs (§2) as concrete PostHog insights. It also records two instrumentation gaps found
by reading the actual branch code, with exact pre-merge fixes.

---

## 0. Taxonomy validation against the branch (2026-08-04)

Read the real code on `wic-814-analytics-instrumentation` (commits `bad58f0` server, `f20a170` client).
All 9 event names + property schemas match `metrics-baseline.md` §3.1–3.3 exactly, including the
`extracted_char_count` name (not `extracted_text_length`). Wrapper `analytics.service.ts` is
provider-agnostic, defaults to `noop`, `track()` never throws. **Sign-off confirmed at code level**
(supersedes my earlier doc-only sign-off on WIC-814, which had a "please confirm code matches" caveat).

**PostHog identity mapping (as coded, updated WIC-822):** `distinct_id = userId` for authenticated
events, falling back to `session_id` for anonymous/pre-login events (`createPostHogSink`), with raw
`session_id` always kept as a property. The client calls `identify(userId)` on login/session-restore
so pre-auth session events alias onto the user. This stable per-user identity is what makes Dashboard C
(§3) computable — see §4 gap 2 (now resolved).

---

## 1. Dashboard A — Upload Health (fully computable at launch)

These are event/session-scoped counts and funnels, so they work correctly regardless of whether
`distinct_id` resolves to `userId` or `session_id` — they compute the moment events flow.

| #   | KPI (§2.1/§2.2)            | PostHog insight         | Definition                                                                                                                                                                                 |
| --- | -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Upload Success Rate        | Funnel                  | Step 1 `resume_upload_submitted` → Step 2 `resume_upload_completed`. Conversion % = success rate. Target ≥95% (§4 warn <97, crit <93).                                                     |
| A2  | Validation Error Rate      | Trends (formula)        | `resume_upload_validation_failed / resume_upload_started`. Target ≤5% (§4 warn >8, crit >15).                                                                                              |
| A3  | Upload Funnel Completion   | Funnel                  | `resume_upload_started` → `resume_upload_submitted` → `resume_upload_completed`. Overall conversion. Target ≥80% (§4 warn <70). Breakdown by `source` (file_picker vs drag_drop).          |
| A4  | Avg / P95 Processing Time  | Trends (property value) | `resume_upload_completed` → property `processing_time_ms`, aggregation Average and P95. Targets: avg ≤3000ms, P95 ≤8000ms (§4 warn >6000, crit >12000). **⚠ Requires gap-1 fix — see §4.** |
| A5  | Parse Success Rate (proxy) | Trends (formula)        | `resume_upload_completed` where `sections_detected > 0`, divided by all `resume_upload_completed`. Target ≥90%.                                                                            |
| A6  | Avg Sections Detected      | Trends (property avg)   | `resume_upload_completed` → avg `sections_detected`. Healthy 4–8.                                                                                                                          |
| A7  | Avg Bullets per Section    | Trends (formula)        | avg(`bullets_total`) / avg(`sections_detected`) on `resume_upload_completed`. Healthy 3–10.                                                                                                |
| A8  | Avg Extracted Text Length  | Trends (property avg)   | `resume_upload_completed` → avg `extracted_char_count`. Healthy 2,000–8,000.                                                                                                               |
| A9  | Failure breakdown          | Trends (breakdown)      | `resume_upload_failed` broken down by `error_stage` (upload/extraction/parsing/export_generation) and `error_code`. Surfaces where the pipeline breaks.                                    |

**HogQL for A4 with the gap-1 fix applied** (exclude duplicate short-circuits from timing):

```sql
SELECT
  avg(properties.processing_time_ms) AS avg_ms,
  quantile(0.95)(properties.processing_time_ms) AS p95_ms
FROM events
WHERE event = 'resume_upload_completed'
  AND properties.is_duplicate = false   -- <-- requires gap-1
  AND timestamp > now() - INTERVAL 7 DAY
```

---

## 2. Dashboard B — Export & Engagement (session-scoped, computable at launch)

| #   | KPI (§2.2/§2.3)           | PostHog insight    | Definition                                                                                                                                    |
| --- | ------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Export View Rate          | Trends (formula)   | `export_viewed` unique sessions / `resume_upload_completed` unique sessions. Target ≥50% (§4 warn <30).                                       |
| B2  | Resume Manager Visit Rate | Trends (formula)   | sessions with `resume_manager_viewed` / total sessions. Target ≥40%.                                                                          |
| B3  | Exports link CTR          | Trends             | `resume_exports_link_clicked` count + breakdown by `resume_file_type`.                                                                        |
| B4  | Post-upload CTA split     | Trends (breakdown) | `resume_upload_cta_clicked` broken down by `cta` (view_details vs upload_new). Signals whether users explore output vs immediately re-upload. |
| B5  | Export generation rate    | Trends (formula)   | `resume_upload_completed` with non-empty `export_id` / all completed. Expect ~100% (1:1).                                                     |

---

## 3. Dashboard C — Retention & Repeat Usage (✅ gap-2 resolved — live once events flow)

These are the §2.3 **user-level** KPIs. As of WIC-822 authed events set `distinct_id = userId`
(server) and the client calls `identify(userId)` on login, so a returning user on a new browser
session resolves to the same PostHog "person". These KPIs are computable the moment events flow to
prod (gated only on WIC-821 prod sink flip, same as A/B).

| #   | KPI (§2.3)                                     | PostHog insight                                            | Status                                                    |
| --- | ---------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| C1  | Return Upload Rate (≥2 resumes / 30d per user) | Retention (event `resume_upload_completed`, 30-day window) | ✅ Live — stable per-user `distinct_id` (WIC-822).        |
| C2  | Uploads per Active User (weekly)               | Trends (total completed / unique users, 7d)                | ✅ Live — "unique users" = unique per-user `distinct_id`. |
| C3  | New vs returning uploaders                     | Trends (breakdown by first-seen)                           | ✅ Live.                                                  |

---

## 4. Instrumentation gaps found in the branch code (pre-merge asks)

### Gap 1 — duplicate short-circuit skews Processing Time KPIs (fix: 1 line + doc)

`resume.service.ts` emits `resume_upload_completed` on the duplicate-content short-circuit
(~line 484) with `processing_time_ms: Date.now() - startTime`. For a duplicate that is a bare DB
lookup (~near-zero ms), and there is **no property to distinguish it** from a real upload. Result:
A4 Avg/P95 Processing Time are pulled downward by every duplicate, under-reporting real latency and
potentially masking §4 alert conditions.

Emitting on duplicates is correct for funnel/completion counting (A1/A3) — do **not** stop emitting.
The fix is to make duplicates _filterable_:

- Add `is_duplicate: boolean` to `ResumeUploadCompletedProps` (analytics.service.ts) and to
  `metrics-baseline.md` §3.1 `resume_upload_completed`.
- Set `is_duplicate: true` at the duplicate callsite (~line 484), `false` at the normal callsite (~line 593).
- Dashboards then filter `is_duplicate = false` for timing (A4) and keep all rows for funnels.

### Gap 2 — session-only `distinct_id` blocks user-level retention KPIs (✅ RESOLVED, WIC-822)

**Was:** `createPostHogSink` set `distinct_id = session_id` for every event, so the §2.3 retention
KPIs (C1–C3) were not computable — every session looked like a new person.

**Fixed as coded (WIC-822):**

- Server events (`analytics.service.ts` + authed `resume.service.ts` callsites): `track()` takes an
  optional `userId`; when present it becomes `distinct_id` (falling back to `session_id` for
  anonymous flows). `session_id` is always retained as an event property.
- Client (`analytics.ts` + `AuthContext.tsx`): calls PostHog `identify(userId)` on
  login/session-restore and `reset()` on logout, so pre-auth session events alias onto the user.
- Net effect: the funnel stitches across client→server for a logged-in user and Dashboard C is live.

Applied consistently across both halves (server distinct_id + client identify), so the per-session /
per-user mix does not break funnels. Upload-health and engagement dashboards (A/B) were unaffected.

---

## 5. Rollout sequence

1. PR e7b65048 merged (server + client, one branch).
2. Gap-1 fix in before merge (cheap, unblocks A4). Gap-2 tracked as follow-on for Dashboard C.
3. Prod wiring: `ANALYTICS_SINK=posthog` + `POSTHOG_API_KEY`/`POSTHOG_HOST` (waits on the
   SUPABASE_DATABASE_URL / WIC-633 prod-DB incident).
4. Verify with `ANALYTICS_SINK=console` in staging first — confirm all 9 events fire with §3 props.
5. Build Dashboards A & B, wire §4 threshold alerts. Dashboard C now ships alongside (gap-2 resolved, WIC-822).
