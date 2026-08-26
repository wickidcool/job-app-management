# PostHog dashboard build pack — dashboard-spec.md v1.0 → executable insights

**Author:** Data Analyst (01d53393) · **Project:** PostHog 551963 (us.posthog.com) · **Date:** 2026-08-19

Every insight in `docs/analytics/dashboard-spec.md` (A1–A9, B1–B5, C1–C3) authored and **executed against
the live project** — 18/18 payloads green (17 built + 1 gated). This turns the remaining work into a
mechanical `POST /api/projects/551963/insights/` loop over `insight-payloads.json`, driven by
`build_dashboards.py`.

## Validation status

| Insight                                   | Dashboard | Executed | Returned from live project                            |
| ----------------------------------------- | --------- | -------- | ----------------------------------------------------- |
| A1 — Upload Success Rate                  | A         | PASS     | funnel `1 → 1` (native, see below)                    |
| A2 — Validation Error Rate                | A         | PASS     | `[0, 0, None]`                                        |
| A3 — Upload Funnel Completion (by source) | A         | PASS     | `[None, 0, 1, 1, None]`                               |
| A4 — Avg / P95 Processing Time            | A         | PASS     | `[1, 1873.0, 1873.0]`                                 |
| A5 — Parse Success Rate (proxy)           | A         | PASS     | `[1, 1, 100.0]`                                       |
| A6 — Avg Sections Detected                | A         | PASS     | `[4.0]`                                               |
| A7 — Avg Bullets per Section              | A         | PASS     | `[17.0, 4.0, 4.25]`                                   |
| A8 — Avg Extracted Text Length            | A         | PASS     | `[3120.0]`                                            |
| A9 — Failure Breakdown                    | A         | PASS     | `['extraction', 'SMOKE_WIC996_synthetic_failure', 1]` |
| B1 — Export View Rate                     | B         | PASS     | `[1, 0, 0.0]`                                         |
| B2 — Resume Manager Visit Rate            | B         | PASS     | `[2, 0, 0.0]`                                         |
| B3 — Exports Link CTR                     | B         | PASS     | `—`                                                   |
| B4 — Post-upload CTA Split                | B         | PASS     | `—`                                                   |
| B5 — Export Generation Rate               | B         | PASS     | `[1, 1, 100.0]`                                       |
| C1 — Return Upload Rate (30d)             | C         | PASS     | 5-week cohort grid (native, see below)                |
| C2 — Uploads per Active User (weekly)     | C         | PASS     | `[1, 1, 1.0]`                                         |
| C3 — New vs Returning Uploaders           | C         | PASS     | `['new', 1]`                                          |

## Why this is stronger than a parse check

HogQL returns `null` for a misspelled property rather than erroring, so execution alone would not prove
the property names are right. It does here because the WIC-996 smoke-test events carry **real payloads**,
so these insights returned actual computed values that could only come from correctly-named properties:

- `A4` → `avg_ms = 1873.0` — `processing_time_ms` resolves **and** the `is_duplicate = 'false'` gap-1 filter matches
- `A6` → `sections_detected = 4`; `A7` → `bullets_total = 17`; `A8` → `extracted_char_count = 3120`
- `A9` → `error_stage = 'extraction'`, `error_code` resolved
- `B5` → `export_id` present on completed; `B1`/`B2` → `session_id` resolves (2 sessions)

Names were cross-checked against the shipped code: `packages/api/src/services/analytics.service.ts`
(`ResumeUploadCompletedProps` / `ResumeUploadFailedProps`) and `packages/web/src/services/analytics.ts`
(`ClientAnalyticsEventProps`). The spec's `extracted_char_count` (not `extracted_text_length`) is correct.

## Caveats to carry into the build

1. **`A3` breakdown returns `source = null` today.** `resume_upload_started` is a client event and has never
   fired — see the coverage gap below. The query is correct; the dimension is simply unpopulated.
2. **Booleans are compared as strings** (`toString(properties.is_duplicate) = 'false'`) — PostHog serializes
   JSON property booleans, so a bare `= false` is not reliable. Keep the `toString` form.
3. **C1–C3 key on `person_id`**, which is what makes them depend on the WIC-822 server attribution +
   WIC-825 client `identify()` alias. Both are merged, so the identity graph is correct in principle, but
   it is **unproven against real multi-session traffic** — re-check C1–C3 once organic users exist.
4. ~~These are `HogQLQuery` insights rather than native funnel/retention nodes.~~ **Resolved 2026-08-19** —
   see "Native visualisation nodes" below. `A1` and `C1` now ship as real `FunnelsQuery` / `RetentionQuery`
   insights; `A3` is the one deliberate exception.

## Native visualisation nodes (resolves caveat 4)

`POST /api/projects/551963/query/` executes `FunnelsQuery`, `RetentionQuery` and `TrendsQuery` nodes under
**read** scope, so the native nodes could be authored and validated against live data without the write
scope this ticket is blocked on. Two of the three were swapped in and re-validated:

| Insight | Was         | Now                     | Live result                                   |
| ------- | ----------- | ----------------------- | --------------------------------------------- |
| `A1`    | HogQL table | `FunnelsQuery`          | 2 steps, `1 → 1`, conversion time `0.29s`     |
| `C1`    | HogQL table | `RetentionQuery`        | 5-week grid; `2026-08-16` cohort week 0 = `1` |
| `A3`    | HogQL table | HogQL table (unchanged) | native variant authored but **gated**         |

**Why `A3` stays HogQL.** Its native funnel is authored and syntactically correct, but a native funnel whose
**step 1 has zero entrants returns `[]` and renders entirely blank**. `resume_upload_started` has never fired
(see the coverage gap below), so swapping `A3` today would be a _regression_: the HogQL version still shows
the step 2/3 counts that did happen. The native payload therefore ships as `A3n_upload_funnel_native` with
`_enabled: false`; flip it (and set `A3 _enabled: false`) once the client event lands.

This was verified rather than assumed — the empty result is not a malformed `breakdownFilter`. Breaking down
the _same_ funnel on a known-present property (`is_duplicate`) returns `breakdown_value: "false"` correctly,
and the 3-step funnel is empty even with the breakdown removed. The cause is the absent step-1 event.

`C1`'s definition changed with the node: the HogQL version measured "share of uploaders with ≥2 uploads in
30d", the retention node gives a full weekly first-time-retention cohort grid. The original HogQL is preserved
on each swapped payload under `_hogql_variant` (its own description plus a full `DataTableNode`/`HogQLQuery`
node), which is what keeps this file the single source of truth for all three build routes: `build_dashboards.py`
(Route 1) uses the native node, `make_console_pack.py` (Routes 2/3) falls back to the variant because a native
node cannot be pasted as SQL. **A1 and C1 are therefore the same tile name computing different numbers**
depending on the route — the other 15 tiles are byte-identical across all three. Nothing else diverges; the
native `A3n` is `_enabled: false`, so no route builds it and A3 is the HogQL form everywhere.

## Event coverage gap (blocks meaningful dashboards, not the build)

Only **3 of the 9** taxonomy events have ever reached PostHog, all synthetic (WIC-996 smoke test):

| Event                             | Owner  | Ever seen       |
| --------------------------------- | ------ | --------------- |
| `resume_upload_submitted`         | server | yes (synthetic) |
| `resume_upload_completed`         | server | yes (synthetic) |
| `resume_upload_failed`            | server | yes (synthetic) |
| `resume_upload_started`           | client | **never**       |
| `resume_upload_validation_failed` | client | **never**       |
| `resume_upload_cta_clicked`       | client | **never**       |
| `resume_manager_viewed`           | client | **never**       |
| `resume_exports_link_clicked`     | client | **never**       |
| `export_viewed`                   | client | **never**       |

The client **transport** is proven (WIC-1012 probe round-tripped on the project token), so this is an
absence of traffic, not a broken pipe — the app has been unreachable/broken (WIC-1004 SPA deep-link 404,
WIC-1011 plaintext HTTP). A2, A3, B1–B4 stay empty until real users exercise the client paths.

No `$pageview`/autocapture exists and **that is by design** — the client uses a hand-rolled `/capture`
fetch wrapper, not posthog-js, and `dashboard-spec.md` has zero pageview/UTM/referrer dependencies.
Nothing in this spec is blocked by it.

## Remaining step — one command

The POST loop is implemented in `build_dashboards.py`. It creates the three dashboards, creates the 17
insights, and attaches each one by its `_dashboard` field. It is **idempotent** — dashboards and insights
are matched by exact name, so a re-run updates in place instead of duplicating.

```bash
export POSTHOG_PERSONAL_API_KEY=phx_...
python3 docs/analytics/build_dashboards.py --dry-run   # validate only, no writes
python3 docs/analytics/build_dashboards.py             # create/update for real
```

`--dry-run` needs only the read scope this key already has: it re-executes all 17 HogQL queries against
live project 551963 and prints the plan. **Last run 2026-08-19: 17/17 PASS**, matching
`validation-results.json` exactly.

The real run additionally needs `insight:read`, `insight:write`, `dashboard:read`, `dashboard:write` on
project 551963. The current key has none of the four, so the script's preflight exits `2` and names them:

```
FAIL  PostHog personal API key is missing required scopes:
        - insight: API key missing required scope 'insight:read'
        - dashboard: API key missing required scope 'dashboard:read'
```

Once the scopes are granted, the real run is the whole remaining task — no further design work.
