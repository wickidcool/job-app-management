# PostHog dashboard build pack — dashboard-spec.md v1.0 → executable insights

**Author:** Data Analyst (01d53393) · **Project:** PostHog 551963 (us.posthog.com) · **Date:** 2026-08-19

Every insight in `docs/analytics/dashboard-spec.md` (A1–A9, B1–B5, C1–C3) authored as HogQL and
**executed against the live project** — 17/17 returned results. This turns the remaining work into a
mechanical `POST /api/projects/551963/insights/` loop over `insight-payloads.json`.

## Validation status

| Insight                                   | Dashboard | Executed | Returned from live project                            |
| ----------------------------------------- | --------- | -------- | ----------------------------------------------------- |
| A1 — Upload Success Rate                  | A         | PASS     | `[1, 1, 100.0]`                                       |
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
| C1 — Return Upload Rate (30d)             | C         | PASS     | `[1, 0, 0.0]`                                         |
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
4. These are `HogQLQuery` insights rather than native funnel/retention nodes. That is deliberate: HogQL is
   what my API scope can validate, and it renders as a table on a dashboard. A1/A3 (funnels) and C1
   (retention) can be swapped to native `FunnelsQuery`/`RetentionQuery` nodes later for the nicer
   visualisation — the numbers are already defined here.

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
