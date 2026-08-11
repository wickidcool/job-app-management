# Job Application Manager — PostHog Dashboard Spec

**Version:** 1.0
**Date:** 2026-08-04
**Owner:** Data Analyst (WIC-814 dashboards)
**Status:** **Live as of 2026-08-11** — prod `ANALYTICS_SINK=posthog` is deployed on both server (WIC-821) and client (WIC-899) tiers, so all 9 events are now capturing to PostHog. Dashboards A & B are computable now; Dashboard C awaits the client `identify(userId)` alias (WIC-825).
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

**PostHog identity mapping (as coded, WIC-822 merged):** `distinct_id = userId ?? session_id ?? anonymous`
(`createPostHogSink`) — authenticated server events attribute to the user, pre-login events fall back to
`session_id`; raw `session_id` is always kept as a property. This is the single most important fact for
the dashboards below. The server-side half of gap 2 is now closed; the client `identify(userId)` alias
(WIC-825) is still open, so pre-login and authed events remain two identities until it lands — see §4 gap 2.

---

## 1. Dashboard A — Upload Health (fully computable at launch)

All events here are session/event-scoped, so per-session `distinct_id` is fine (authed events now key
on `userId`, but these funnels aggregate per session either way). These insights work correctly the
moment events flow.

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

## 3. Dashboard C — Retention & Repeat Usage (⚠ partially unblocked; client alias still pending)

These are the §2.3 **user-level** KPIs. The server-side half of gap-2 (WIC-822) is now merged, so
authenticated **server** events (`resume_upload_*`) already carry `distinct_id = userId` and are
user-scoped. They are **still not fully computable** until the client `identify(userId)` alias (WIC-825)
lands: client-side session events (`resume_manager_viewed`, `export_viewed`, CTA clicks) remain keyed on
`session_id`, so a returning user on a new browser session is still a brand-new "person" to PostHog for
those events, and client→server funnels don't stitch. C1 (built purely on the server `resume_upload_completed`
event) is computable now; C2/C3 that mix in client events wait on WIC-825.

| #   | KPI (§2.3)                                     | PostHog insight                                            | Blocker                                                                                                    |
| --- | ---------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| C1  | Return Upload Rate (≥2 resumes / 30d per user) | Retention (event `resume_upload_completed`, 30-day window) | ✅ Unblocked — server event now keys on `userId`.                                                          |
| C2  | Uploads per Active User (weekly)               | Trends (total completed / unique users, 7d)                | Server side ready; "unique users" is accurate for authed uploads. Client alias (WIC-825) for full picture. |
| C3  | New vs returning uploaders                     | Trends (breakdown by first-seen)                           | Needs client `identify(userId)` alias (WIC-825) so pre-login sessions fold into the user.                  |

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

### Gap 2 — user-level retention KPIs (server half ✅ merged WIC-822; client alias WIC-825 open)

**Server half — DONE (WIC-822, merged `d9fe98e`).** `createPostHogSink` now sets
`distinct_id = userId ?? session_id ?? anonymous`, keeping `session_id` as a property. Authenticated
server events (`resume_upload_*`) are user-scoped.

**Client half — still open (WIC-825).** Call PostHog `identify(userId)` on login so client-side
session events (`resume_manager_viewed`, `export_viewed`, CTA clicks) alias onto the user. Until this
lands, pre-login/client events and authed server events are two separate PostHog identities, so
client→server funnels for a logged-in user don't stitch and any C-dashboard KPI that mixes client
events is incomplete.

Trade-off: mixing per-session and per-user `distinct_id` in one funnel breaks it, so both halves must
be consistent — hence a follow-on, not a one-liner. Upload-health and engagement dashboards (A/B) are
unaffected. C1 (server `resume_upload_completed` retention) is computable now; C2/C3 wait on WIC-825.

---

## 5. Rollout sequence

1. PR e7b65048 merged (server + client, one branch).
2. Gap-1 fix in before merge (cheap, unblocks A4). Gap-2 server half merged (WIC-822); client `identify` alias (WIC-825) is the remaining follow-on for full Dashboard C.
3. Prod wiring: `ANALYTICS_SINK=posthog` + `POSTHOG_API_KEY`/`POSTHOG_HOST` (waits on the
   SUPABASE_DATABASE_URL / WIC-633 prod-DB incident).
4. Verify with `ANALYTICS_SINK=console` in staging first — confirm all 9 events fire with §3 props.
5. Build Dashboards A & B, wire §4 threshold alerts. Dashboard C after gap-2.
