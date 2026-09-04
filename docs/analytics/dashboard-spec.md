# Careerpin — PostHog Dashboard Spec

**Version:** 1.1
**Date:** 2026-08-04 (rev 1.1 — 2026-08-26, §6 failure telemetry, WIC-1476)
**Owner:** Data Analyst (WIC-814 dashboards)
**Status:** **Live as of 2026-08-11** — prod `ANALYTICS_SINK=posthog` is deployed on both server (WIC-821) and client (WIC-899) tiers, so all 9 events are now capturing to PostHog. Dashboards A & B were computable at launch; the client `identify(userId)` alias then shipped (WIC-825, PR #72, 2026-08-13), so **Dashboard C is now fully computable** too — all three dashboards are live.
**Depends on:** taxonomy on branch `wic-814-analytics-instrumentation` (validated below), PR merge (e7b65048), prod sink flip.

This is the deploy-ready mapping from the 9-event taxonomy (`metrics-baseline.md` §3) to
the KPIs (§2) as concrete PostHog insights. It also records two instrumentation gaps found
by reading the actual branch code, with exact pre-merge fixes.

> **§6 is normative and was added in rev 1.1.** Failure counts are derived from the
> `submitted`-with-no-terminal-event **gap**, never from `count(resume_upload_failed)` — that event
> is delivered by a `fetch` subrequest and is dropped by the very outages it is meant to report.
> A10 is the failure KPI of record; A9 is diagnostic only. **Do not implement out-of-band emission
> with `ctx.waitUntil()`** — it shares the same exhausted per-invocation budget. See §6.

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
the dashboards below. Both halves of gap 2 are now closed: the server-side attribution (WIC-822) and the
client `identify(userId)` alias (WIC-825, PR #72), so pre-login and authed events now resolve to one
identity — see §4 gap 2.

---

## 1. Dashboard A — Upload Health (fully computable at launch)

All events here are session/event-scoped, so per-session `distinct_id` is fine (authed events now key
on `userId`, but these funnels aggregate per session either way). These insights work correctly the
moment events flow.

| #   | KPI (§2.1/§2.2)            | PostHog insight         | Definition                                                                                                                                                                                 |
| --- | -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Upload Success Rate        | Funnel                  | Step 1 `resume_upload_submitted` → Step 2 `resume_upload_completed`. Conversion % = success rate. Target ≥95% (§4 warn <97, crit <93). **Already gap-derived — do not "fix" this to use `_failed`. See §6.** |
| A2  | Validation Error Rate      | Trends (formula)        | `resume_upload_validation_failed / resume_upload_started`. Target ≤5% (§4 warn >8, crit >15).                                                                                              |
| A3  | Upload Funnel Completion   | Funnel                  | `resume_upload_started` → `resume_upload_submitted` → `resume_upload_completed`. Overall conversion. Target ≥80% (§4 warn <70). Breakdown by `source` (file_picker vs drag_drop).          |
| A4  | Avg / P95 Processing Time  | Trends (property value) | `resume_upload_completed` → property `processing_time_ms`, aggregation Average and P95. Targets: avg ≤3000ms, P95 ≤8000ms (§4 warn >6000, crit >12000). **⚠ Requires gap-1 fix — see §4.** |
| A5  | Parse Success Rate (proxy) | Trends (formula)        | `resume_upload_completed` where `sections_detected > 0`, divided by all `resume_upload_completed`. Target ≥90%.                                                                            |
| A6  | Avg Sections Detected      | Trends (property avg)   | `resume_upload_completed` → avg `sections_detected`. Healthy 4–8.                                                                                                                          |
| A7  | Avg Bullets per Section    | Trends (formula)        | avg(`bullets_total`) / avg(`sections_detected`) on `resume_upload_completed`. Healthy 3–10.                                                                                                |
| A8  | Avg Extracted Text Length  | Trends (property avg)   | `resume_upload_completed` → avg `extracted_char_count`. Healthy 2,000–8,000.                                                                                                               |
| A9  | Failure breakdown          | Trends (breakdown)      | `resume_upload_failed` broken down by `error_stage` (upload/extraction/parsing/export_generation) and `error_code`. Surfaces **where** the pipeline breaks. **⚠ DIAGNOSTIC ONLY — never the count of record. Its total is a lower bound and collapses toward 0 during exactly the outages you care about. See §6.** |
| A10 | Upload Failure Rate        | Trends (formula)        | **`(count(resume_upload_submitted) - count(resume_upload_completed)) / count(resume_upload_submitted)`**, probe-excluded. This is the failure count/rate **of record**. Target ≤5% (§4 warn >3%, crit >7% — the complement of A1). See §6 for why it is gap-derived and its known biases. |

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

## 3. Dashboard C — Retention & Repeat Usage (✅ fully unblocked)

These are the §2.3 **user-level** KPIs. Both halves of gap-2 are now merged: the server-side attribution
(WIC-822) and the client `identify(userId)` alias (WIC-825, PR #72). Authenticated **server** events
(`resume_upload_*`) carry `distinct_id = userId`, and on login the SPA emits a `$identify` event whose
`$anon_distinct_id` alias folds pre-login `session_id` events (`resume_manager_viewed`, `export_viewed`,
CTA clicks) onto the authenticated user, with `reset()` clearing identity on logout. A returning user on
a new browser session now resolves to the same PostHog person, and client→server funnels stitch. **All
of C1–C3 are computable.**

| #   | KPI (§2.3)                                     | PostHog insight                                            | Status                                                                                          |
| --- | ---------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| C1  | Return Upload Rate (≥2 resumes / 30d per user) | Retention (event `resume_upload_completed`, 30-day window) | ✅ Computable — server event keys on `userId`.                                                  |
| C2  | Uploads per Active User (weekly)               | Trends (total completed / unique users, 7d)                | ✅ Computable — client `identify()` (WIC-825) stitches sessions, so "unique users" is accurate. |
| C3  | New vs returning uploaders                     | Trends (breakdown by first-seen)                           | ✅ Computable — client `identify()` (WIC-825) folds pre-login sessions into the user.           |

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

### Gap 2 — user-level retention KPIs (✅ both halves merged: server WIC-822, client WIC-825)

**Server half — DONE (WIC-822, merged `d9fe98e`).** `createPostHogSink` now sets
`distinct_id = userId ?? session_id ?? anonymous`, keeping `session_id` as a property. Authenticated
server events (`resume_upload_*`) are user-scoped.

**Client half — DONE (WIC-825, PR #72, merged `2b1f4a7`).** `AuthContext` calls
`identify(userId)` on login/registration and `reset()` on logout (`packages/web/src/services/analytics.ts`).
`identify()` emits a PostHog `$identify` event whose `$anon_distinct_id` alias merges the prior anonymous
session person into the identified user, so client-side session events (`resume_manager_viewed`,
`export_viewed`, CTA clicks) fold onto the user and client→server funnels for a logged-in user stitch.

Trade-off (historical): mixing per-session and per-user `distinct_id` in one funnel breaks it, so both
halves had to be consistent — hence a follow-on rather than a one-liner. Both are now merged, so all of
C1–C3 are computable. Upload-health and engagement dashboards (A/B) were unaffected throughout.

---

## 5. Rollout sequence

1. PR e7b65048 merged (server + client, one branch).
2. Gap-1 fix in before merge (cheap, unblocks A4). Gap-2 both halves now merged — server (WIC-822) and client `identify` alias (WIC-825, PR #72) — so full Dashboard C is unblocked.
3. Prod wiring: `ANALYTICS_SINK=posthog` + `POSTHOG_API_KEY`/`POSTHOG_HOST` (waits on the
   SUPABASE_DATABASE_URL / WIC-633 prod-DB incident).
4. Verify with `ANALYTICS_SINK=console` in staging first — confirm all 9 events fire with §3 props.
5. Build Dashboards A & B, wire §4 threshold alerts. Gap-2 is now closed (WIC-822 + WIC-825), so Dashboard C can be built alongside them.
6. **Failure telemetry (§6, WIC-1476):** A10 (gap-derived) is the failure count of record; A9 is diagnostic only. Wire the §6.6 alert — it needs no deploy and runs on events already flowing.

---

## 6. Failure telemetry is gap-derived, not event-derived (WIC-1476 / ADR-007 §4)

**Rule: a `resume_upload_submitted` with no matching terminal event _is_ a failure. Count failures
that way. Never treat `count(resume_upload_failed)` as the number of failures.**

### 6.1 Why — the event cannot survive the condition it reports on

`resume.service.ts:759` awaits `track('resume_upload_failed', …)` inside its catch block before
re-raising. `track()` delivers over `fetch()` (`analytics.service.ts`, `createPostHogSink`), and on
Cloudflare a `fetch` is a **subrequest**. When the upload fails *because the Worker exhausted its
subrequest budget*, the capture call has no budget left and the event is silently dropped.

The loss is **correlated with the incident**: events vanish exactly when they cluster, so a panel
built on `_failed` reads *lower* during a total outage and can read **0** during a complete one. It
biases toward false calm precisely when the dashboard is being looked at. `_submitted` survives
because it is emitted at `resume.service.ts:450`, before `getDb()` and before any dependency work,
when the budget is still intact.

### 6.2 Measured, in production (2026-08-26)

Lifetime counts in PostHog project 551963, all upload legs:

| Event                      | Count | Window                                      |
| -------------------------- | ----- | ------------------------------------------- |
| `resume_upload_submitted`  | 2     | 2026-08-18T04:48:45Z → 2026-08-26T04:19:39Z |
| `resume_upload_completed`  | 1     | 2026-08-18T04:48:45Z                        |
| `resume_upload_failed`     | 1     | 2026-08-18T04:48:45Z                        |

Split by session, the two behave completely differently:

| `session_id`               | submitted | completed | failed | What it was                                          |
| -------------------------- | --------- | --------- | ------ | ---------------------------------------------------- |
| `smoke-wic996-064d2fae…`   | 1         | 1         | 1      | WIC-996 smoke test — fired all three names directly at `/capture` 0.3s apart. Not a real pipeline run. |
| `wic967-devops-1787717978` | 1         | **0**     | **0**  | WIC-967: a **real authenticated** `POST /api/resumes/upload` against production that **returned 500**. |

The WIC-967 row is the defect, observed end to end. A genuine production 500 produced
`count(resume_upload_failed) == 0`. The gap metric scores it correctly: `submitted - completed`
= 1. Every `_failed` event that exists in this project is synthetic; the one real failure emitted
none.

### 6.3 Do **NOT** implement out-of-band emission with `ctx.waitUntil()`

The subrequest cap is per **invocation** — the runtime's own error string is
`Too many subrequests by single Worker invocation`. `waitUntil` callbacks run inside that same
invocation, so a deferred `fetch` is charged to the same exhausted budget and dropped identically.
It would look like a fix, pass review, and still lose every event during an outage.

There is currently **no `waitUntil` anywhere in `packages/api/src`** — this is a guardrail against
introducing one, not a description of existing code.

Genuinely out-of-band delivery means a **Tail Worker or Logpush**, which execute as a *separate*
invocation with their own budget. That is the only acceptable mechanism if out-of-band emission is
wanted later, and it is not required for anything in this section.

### 6.4 Keep emitting `_failed` — as diagnosis, never as the count

`_failed` is the only carrier of `error_code` and `error_stage`, which the gap metric structurally
cannot produce. Keep it, keep A9. Read it as *"of the failures that managed to report themselves,
here is where they broke"* — a **lower bound**, and a **biased sample** (failures caused by resource
exhaustion are the ones most likely to be missing, so A9 systematically under-represents them).

### 6.5 Known limitations of the gap metric — state these on the panel

1. **There is no per-upload correlation id.** `_submitted` carries `{session_id, file_type,
   file_size_bytes}`; `_completed` carries `{session_id, resume_id, export_id, …}`. No field links a
   specific submit to a specific terminal event. So the metric is only valid **in aggregate**
   (count-level) or **per session with exactly one upload** — a session that uploads twice and fails
   once nets out to "fine". *Recommended fix, cheap and additive: emit a shared `upload_id` (ULID,
   generated at `resume.service.ts:444` next to `startTime`) on all three of `_submitted`,
   `_completed` and `_failed`. That makes the gap exactly joinable and removes both this limitation
   and limitation 2.*
2. **Window-boundary error.** An upload submitted at 23:59 and completed at 00:01 counts as a
   failure in the first window. Immaterial at 3s median processing time and daily/weekly grain; it
   matters if anyone builds a per-minute panel. Don't.
3. **It over-counts rather than under-counts under pressure.** If the pipeline consumes the last of
   the budget and *succeeds*, the `_completed` capture at `resume.service.ts:596` can itself be
   dropped — the user gets a 200 and the gap records a phantom failure. This is the **opposite**
   bias to `_failed`, and it is the safe direction: the metric fails **loud** during an incident
   instead of silent. Accept it. It also means A10 should be read as an upper bound on true failure
   rate, just as A9 is a lower bound; the truth is bracketed between them.
4. **Probe exclusion is mandatory, and matters more here than anywhere else.** An end-to-end probe
   that submits without completing is *byte-identical in shape* to a real outage — that is exactly
   what WIC-967 looks like in §6.2. Apply `docs/analytics/probe-registry.json` exclusion keys **and**
   the prefix predicates from `organic_watch.py` (`startsWith(distinct_id, 'probe-'/'smoke-'/'qa-')`,
   `match(toString(properties.session_id), '^wic[0-9]+-')`) before computing A10 or firing the §6.6
   alert. Note WIC-967's `distinct_id` is a bare Supabase auth UUID set server-side and **cannot**
   carry a prefix — the registry is the only thing that catches it. Use `startsWith()`, never
   `LIKE 'qa\_%'`: HogQL rejects the `\_` escape with a hard 400.

### 6.6 Alert — monitor the blind spot now, before any code change

This needs no deploy and no new instrumentation; it runs on events already flowing.

Both queries below were **executed against production project 551963 on 2026-08-26** and their
outputs are quoted. Alias reuse across `SELECT` expressions works in HogQL; the `if()` zero-guard
behaves as documented.

**Query 1 — headline rate (A10).** Substitute the probe-exclusion predicate emitted by
`organic_watch.py` (`build_predicates()` returns it; drop its trailing `AND timestamp > …`
watermark, which is watcher state, not part of the alert).

```sql
SELECT
  countIf(event = 'resume_upload_submitted')                AS submitted,
  countIf(event = 'resume_upload_completed')                AS completed,
  countIf(event = 'resume_upload_failed')                   AS failed_reported,
  submitted - completed                                     AS failures_derived,
  if(submitted = 0, 0, (submitted - completed) / submitted) AS failure_rate
FROM events
WHERE event IN ('resume_upload_submitted', 'resume_upload_completed', 'resume_upload_failed')
  AND timestamp > now() - INTERVAL 1 DAY
  -- AND <ORGANIC_PREDICATE from organic_watch.py>
```

- **Warn** `failure_rate > 3%`, **critical** `> 7%` (complement of the A1 ≥95% target and its §4
  warn <97 / crit <93 thresholds — keep the two in sync; they are the same quantity).
- Zero organic traffic ⇒ all counts 0 and `failure_rate` 0 by the `if()` guard. Verified: with the
  probe predicate applied this returns `0, 0, 0, 0, 0.0`. That is correct and **must not raise** —
  an empty funnel is a traffic fact, not a defect.
- Without exclusion, lifetime returns `submitted=2, completed=1, failed_reported=1,
  failures_derived=1, failure_rate=0.5` — the metric detects the WIC-967 failure that
  `_failed` missed.

**Query 2 — telemetry-integrity alarm. Must be computed PER SESSION, not as an aggregate
difference.**

```sql
SELECT
  countIf(sub > 0 AND comp = 0 AND fail = 0) AS silent_failures,    -- submitted, then nothing
  countIf(sub > 0 AND comp = 0 AND fail > 0) AS reported_failures,  -- submitted, then _failed
  countIf(sub > 0 AND comp > 0)              AS successes
FROM (
  SELECT toString(properties.session_id)                AS sid,
         countIf(event = 'resume_upload_submitted')     AS sub,
         countIf(event = 'resume_upload_completed')     AS comp,
         countIf(event = 'resume_upload_failed')        AS fail
  FROM events
  WHERE event IN ('resume_upload_submitted', 'resume_upload_completed', 'resume_upload_failed')
    AND timestamp > now() - INTERVAL 1 DAY
    -- AND <ORGANIC_PREDICATE from organic_watch.py>
  GROUP BY sid
)
```

**`silent_failures > 0` is its own alarm**, independent of the rate: it means the telemetry path
itself is degrading. That is the WIC-967 signature, and the number the `_failed` panel can never
show you.

> **Why per-session, and not `failures_derived - failed_reported`.** That aggregate form was the
> obvious formulation and it is **wrong** — it was tried first and it silently reported `0`. Any
> session that emits *both* `_completed` and `_failed` contributes a spurious `+1` to
> `failed_reported` that **cancels** a genuinely missing `_failed` elsewhere in the window. On
> lifetime data the WIC-996 smoke test does exactly this, hiding WIC-967: the aggregate gives
> `silently_lost = 1 - 1 = 0`, while the per-session query above correctly gives
> `silent_failures = 1, reported_failures = 0, successes = 1`. Cross-session cancellation makes the
> aggregate form fail in the same direction as the bug it is meant to catch. **Do not use it.**

### 6.7 Consequences for the rest of this document

- **A1 (funnel) was already correct.** A PostHog funnel measures `submitted → completed`
  conversion — it is gap-derived by construction and never reads `_failed`. It needed no change and
  must not be "corrected" to use `_failed`. Its one caveat is that funnel steps correlate per
  *person*, not per upload, so it shares limitation 1 above.
- **A2 (Validation Error Rate) is unaffected.** `resume_upload_validation_failed` and
  `resume_upload_started` are both **client**-side events captured by `posthog-js` in the browser,
  not by the Worker, so the subrequest budget does not apply to them.
- **A9 is demoted** to diagnostic-only (see §6.4). **A10 is the new count of record.**
- `metrics-baseline.md` §2.1 defines Upload Success Rate as `successful_uploads / upload_attempts`.
  That wording is already gap-shaped — `upload_attempts` = `_submitted`, `successful_uploads` =
  `_completed`. No edit needed there; this section pins the interpretation.

---
