# WIC-1024 — zero-scope console build runbook

**For:** whoever holds the PostHog console for project `551963` (https://us.posthog.com) · **Author:** Data Analyst (01d53393) · **Date:** 2026-08-19

This is the **alternative to granting API scopes**. Every insight below was authored from
`dashboard-spec.md` v1.0 and executed green against this live project (17/17 — see
`dashboard-build-pack.md`). Nothing here needs a credential change, a new key, or an agent.

Pick **one** of the three routes. They produce the same three dashboards.

---

## Route 1 — grant the scopes, agent builds it (fastest, ~2 min of console time)

Still the cheapest option if you are willing to scope the existing key.
`Settings → Personal API keys →` the Data Analyst key `→ Scopes`, add:

| Scope             | Why                                          |
| ----------------- | -------------------------------------------- |
| `insight:read`    | read back what was created, for verification |
| `insight:write`   | create the 17 insights                       |
| `dashboard:read`  | read back the 3 dashboards                   |
| `dashboard:write` | create the 3 dashboards and attach tiles     |

Then comment on WIC-1024. Acceptance check is one line — `python3 docs/analytics/build_dashboards.py --dry-run` prints
`OK  scopes present (read+write)` instead of exiting `2`. The build itself is an idempotent loop.

**If you are declining Route 1 on security grounds, that is a reasonable call** — a write-scoped
key is a standing capability. Routes 2 and 3 exist so that decision does not also block the
deliverable. Say so on WIC-1024 and take Route 2.

## Route 2 — import the dashboard JSON (no scope change, ~5 min)

`dashboard-templates.json` in this directory holds three PostHog dashboard-template objects
(A, B, C) with all tiles, queries and layouts pre-filled.

1. `Dashboards → New dashboard`.
2. Choose the **import / paste JSON** option in that modal.
3. Paste the **first array element** of `dashboard-templates.json` (Dashboard A). Create.
4. Repeat for elements 2 (Dashboard B) and 3 (Dashboard C).

> **Caveat, stated honestly:** I cannot exercise the console to confirm the exact wording or
> presence of the JSON-import affordance on your PostHog version — my key is 403 on every
> dashboard endpoint, which is the whole problem. The JSON conforms to PostHog's dashboard-template
> schema (`template_name` / `dashboard_description` / `tiles[].query` / `tiles[].layouts`).
> If your build has no import affordance, Route 3 always works.

## Route 3 — paste each insight by hand (no scope change, always works, ~20 min)

For each row in the table below:

1. `Product analytics → New insight → SQL`.
2. Replace the default query with the HogQL in the matching section.
3. `Save`, using the **Insight name** from the table verbatim (names are load-bearing — the
   spec, the build pack and the alerting thresholds all key on the `A1`/`B3`/`C2` prefixes).
4. `Add to dashboard →` the dashboard named in the table, creating it on first use with the
   description from `dashboard-templates.json`.

The **Open pre-filled** link skips steps 1-2 by carrying the query in the URL fragment; if a link
lands on an empty insight, just paste the SQL from the section below it.

| #   | Insight name                              | Dashboard                              | Open pre-filled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | A1 — Upload Success Rate                  | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20countIf%28event%20%3D%20%27resume_upload_submitted%27%29%20AS%20submitted%2C%5Cn%20%20countIf%28event%20%3D%20%27resume_upload_completed%27%29%20AS%20completed%2C%5Cn%20%20round%28100.0%20%2A%20countIf%28event%20%3D%20%27resume_upload_completed%27%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28countIf%28event%20%3D%20%27resume_upload_submitted%27%29%2C%200%29%2C%202%29%20AS%20success_rate_pct%5CnFROM%20events%5CnWHERE%20event%20IN%20%28%27resume_upload_submitted%27%2C%27resume_upload_completed%27%29%5Cn%20%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                       |
| A2  | A2 — Validation Error Rate                | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20countIf%28event%20%3D%20%27resume_upload_started%27%29%20AS%20started%2C%5Cn%20%20countIf%28event%20%3D%20%27resume_upload_validation_failed%27%29%20AS%20validation_failed%2C%5Cn%20%20round%28100.0%20%2A%20countIf%28event%20%3D%20%27resume_upload_validation_failed%27%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28countIf%28event%20%3D%20%27resume_upload_started%27%29%2C%200%29%2C%202%29%20AS%20validation_error_rate_pct%5CnFROM%20events%5CnWHERE%20event%20IN%20%28%27resume_upload_started%27%2C%27resume_upload_validation_failed%27%29%5Cn%20%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                      |
| A3  | A3 — Upload Funnel Completion (by source) | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20toString%28properties.source%29%20AS%20source%2C%5Cn%20%20countIf%28event%20%3D%20%27resume_upload_started%27%29%20%20%20AS%20s1_started%2C%5Cn%20%20countIf%28event%20%3D%20%27resume_upload_submitted%27%29%20AS%20s2_submitted%2C%5Cn%20%20countIf%28event%20%3D%20%27resume_upload_completed%27%29%20AS%20s3_completed%2C%5Cn%20%20round%28100.0%20%2A%20countIf%28event%20%3D%20%27resume_upload_completed%27%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28countIf%28event%20%3D%20%27resume_upload_started%27%29%2C%200%29%2C%202%29%20AS%20overall_conversion_pct%5CnFROM%20events%5CnWHERE%20event%20IN%20%28%27resume_upload_started%27%2C%27resume_upload_submitted%27%2C%27resume_upload_completed%27%29%5Cn%20%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%5CnGROUP%20BY%20source%5CnORDER%20BY%20s1_started%20DESC%22%7D%7D) |
| A4  | A4 — Avg / P95 Processing Time            | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20count%28%29%20AS%20n_real_uploads%2C%5Cn%20%20round%28avg%28toFloat%28properties.processing_time_ms%29%29%2C%201%29%20AS%20avg_ms%2C%5Cn%20%20round%28quantile%280.95%29%28toFloat%28properties.processing_time_ms%29%29%2C%201%29%20AS%20p95_ms%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_completed%27%5Cn%20%20AND%20toString%28properties.is_duplicate%29%20%3D%20%27false%27%5Cn%20%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                            |
| A5  | A5 — Parse Success Rate (proxy)           | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20count%28%29%20AS%20completed%2C%5Cn%20%20countIf%28toFloat%28properties.sections_detected%29%20%3E%200%29%20AS%20parsed_ok%2C%5Cn%20%20round%28100.0%20%2A%20countIf%28toFloat%28properties.sections_detected%29%20%3E%200%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28count%28%29%2C%200%29%2C%202%29%20AS%20parse_success_rate_pct%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_completed%27%5Cn%20%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                |
| A6  | A6 — Avg Sections Detected                | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%20round%28avg%28toFloat%28properties.sections_detected%29%29%2C%202%29%20AS%20avg_sections_detected%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_completed%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A7  | A7 — Avg Bullets per Section              | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20round%28avg%28toFloat%28properties.bullets_total%29%29%2C%202%29%20%20%20%20AS%20avg_bullets%2C%5Cn%20%20round%28avg%28toFloat%28properties.sections_detected%29%29%2C%202%29%20AS%20avg_sections%2C%5Cn%20%20round%28avg%28toFloat%28properties.bullets_total%29%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28avg%28toFloat%28properties.sections_detected%29%29%2C%200%29%2C%202%29%20AS%20bullets_per_section%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_completed%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                                                            |
| A8  | A8 — Avg Extracted Text Length            | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%20round%28avg%28toFloat%28properties.extracted_char_count%29%29%2C%201%29%20AS%20avg_extracted_char_count%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_completed%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A9  | A9 — Failure Breakdown                    | Dashboard A — Upload Health            | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20toString%28properties.error_stage%29%20AS%20error_stage%2C%5Cn%20%20toString%28properties.error_code%29%20%20AS%20error_code%2C%5Cn%20%20count%28%29%20AS%20failures%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_failed%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%5CnGROUP%20BY%20error_stage%2C%20error_code%5CnORDER%20BY%20failures%20DESC%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B1  | B1 — Export View Rate                     | Dashboard B — Export & Engagement      | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20uniqIf%28toString%28properties.session_id%29%2C%20event%20%3D%20%27resume_upload_completed%27%29%20AS%20completed_sessions%2C%5Cn%20%20uniqIf%28toString%28properties.session_id%29%2C%20event%20%3D%20%27export_viewed%27%29%20%20%20%20%20%20%20%20%20%20%20AS%20export_viewed_sessions%2C%5Cn%20%20round%28100.0%20%2A%20uniqIf%28toString%28properties.session_id%29%2C%20event%20%3D%20%27export_viewed%27%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28uniqIf%28toString%28properties.session_id%29%2C%20event%20%3D%20%27resume_upload_completed%27%29%2C%200%29%2C%202%29%20AS%20export_view_rate_pct%5CnFROM%20events%5CnWHERE%20event%20IN%20%28%27resume_upload_completed%27%2C%27export_viewed%27%29%5Cn%20%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                             |
| B2  | B2 — Resume Manager Visit Rate            | Dashboard B — Export & Engagement      | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20uniq%28toString%28properties.session_id%29%29%20AS%20total_sessions%2C%5Cn%20%20uniqIf%28toString%28properties.session_id%29%2C%20event%20%3D%20%27resume_manager_viewed%27%29%20AS%20manager_sessions%2C%5Cn%20%20round%28100.0%20%2A%20uniqIf%28toString%28properties.session_id%29%2C%20event%20%3D%20%27resume_manager_viewed%27%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28uniq%28toString%28properties.session_id%29%29%2C%200%29%2C%202%29%20AS%20manager_visit_rate_pct%5CnFROM%20events%5CnWHERE%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                                               |
| B3  | B3 — Exports Link CTR                     | Dashboard B — Export & Engagement      | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20toString%28properties.resume_file_type%29%20AS%20resume_file_type%2C%5Cn%20%20count%28%29%20AS%20clicks%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_exports_link_clicked%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%5CnGROUP%20BY%20resume_file_type%5CnORDER%20BY%20clicks%20DESC%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| B4  | B4 — Post-upload CTA Split                | Dashboard B — Export & Engagement      | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20toString%28properties.cta%29%20AS%20cta%2C%5Cn%20%20count%28%29%20AS%20clicks%2C%5Cn%20%20round%28100.0%20%2A%20count%28%29%20%2F%20nullIf%28sum%28count%28%29%29%20OVER%20%28%29%2C%200%29%2C%202%29%20AS%20pct_of_clicks%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_cta_clicked%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%5CnGROUP%20BY%20cta%5CnORDER%20BY%20clicks%20DESC%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| B5  | B5 — Export Generation Rate               | Dashboard B — Export & Engagement      | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20count%28%29%20AS%20completed%2C%5Cn%20%20countIf%28toString%28properties.export_id%29%20%21%3D%20%27%27%20AND%20toString%28properties.export_id%29%20%21%3D%20%27null%27%29%20AS%20with_export_id%2C%5Cn%20%20round%28100.0%20%2A%20countIf%28toString%28properties.export_id%29%20%21%3D%20%27%27%20AND%20toString%28properties.export_id%29%20%21%3D%20%27null%27%29%5Cn%20%20%20%20%20%20%20%20%2F%20nullIf%28count%28%29%2C%200%29%2C%202%29%20AS%20export_generation_rate_pct%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_completed%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                          |
| C1  | C1 — Return Upload Rate (30d)             | Dashboard C — Retention & Repeat Usage | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20count%28%29%20AS%20uploaders_30d%2C%5Cn%20%20countIf%28uploads%20%3E%3D%202%29%20AS%20returning_uploaders%2C%5Cn%20%20round%28100.0%20%2A%20countIf%28uploads%20%3E%3D%202%29%20%2F%20nullIf%28count%28%29%2C%200%29%2C%202%29%20AS%20return_upload_rate_pct%5CnFROM%20%28%5Cn%20%20SELECT%20person_id%2C%20count%28%29%20AS%20uploads%5Cn%20%20FROM%20events%5Cn%20%20WHERE%20event%20%3D%20%27resume_upload_completed%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%2030%20DAY%5Cn%20%20GROUP%20BY%20person_id%5Cn%29%22%7D%7D)                                                                                                                                                                                                                                                                                                                  |
| C2  | C2 — Uploads per Active User (weekly)     | Dashboard C — Retention & Repeat Usage | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20count%28%29%20AS%20total_completed%2C%5Cn%20%20uniq%28person_id%29%20AS%20active_users%2C%5Cn%20%20round%28count%28%29%20%2F%20nullIf%28uniq%28person_id%29%2C%200%29%2C%202%29%20AS%20uploads_per_active_user%5CnFROM%20events%5CnWHERE%20event%20%3D%20%27resume_upload_completed%27%20AND%20timestamp%20%3E%20now%28%29%20-%20INTERVAL%207%20DAY%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| C3  | C3 — New vs Returning Uploaders           | Dashboard C — Retention & Repeat Usage | [open](https://us.posthog.com/project/551963/insights/new#q=%7B%22kind%22%3A%22DataTableNode%22%2C%22source%22%3A%7B%22kind%22%3A%22HogQLQuery%22%2C%22query%22%3A%22SELECT%5Cn%20%20multiIf%28first_upload%20%3E%3D%20now%28%29%20-%20INTERVAL%207%20DAY%2C%20%27new%27%2C%20%27returning%27%29%20AS%20cohort%2C%5Cn%20%20count%28%29%20AS%20uploaders%5CnFROM%20%28%5Cn%20%20SELECT%20person_id%2C%20min%28timestamp%29%20AS%20first_upload%5Cn%20%20FROM%20events%5Cn%20%20WHERE%20event%20%3D%20%27resume_upload_completed%27%5Cn%20%20GROUP%20BY%20person_id%5Cn%29%5CnGROUP%20BY%20cohort%5CnORDER%20BY%20cohort%22%7D%7D)                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## The 17 queries

### A1 — Upload Success Rate

_Dashboard A — Upload Health · submitted -> completed conversion. Target >=95% (warn <97, crit <93)._

```sql
SELECT
  countIf(event = 'resume_upload_submitted') AS submitted,
  countIf(event = 'resume_upload_completed') AS completed,
  round(100.0 * countIf(event = 'resume_upload_completed')
        / nullIf(countIf(event = 'resume_upload_submitted'), 0), 2) AS success_rate_pct
FROM events
WHERE event IN ('resume_upload_submitted','resume_upload_completed')
  AND timestamp > now() - INTERVAL 7 DAY
```

### A2 — Validation Error Rate

_Dashboard A — Upload Health · validation_failed / started. Target <=5% (warn >8, crit >15)._

```sql
SELECT
  countIf(event = 'resume_upload_started') AS started,
  countIf(event = 'resume_upload_validation_failed') AS validation_failed,
  round(100.0 * countIf(event = 'resume_upload_validation_failed')
        / nullIf(countIf(event = 'resume_upload_started'), 0), 2) AS validation_error_rate_pct
FROM events
WHERE event IN ('resume_upload_started','resume_upload_validation_failed')
  AND timestamp > now() - INTERVAL 7 DAY
```

### A3 — Upload Funnel Completion (by source)

_Dashboard A — Upload Health · started -> submitted -> completed, broken down by source. Target >=80% (warn <70)._

```sql
SELECT
  toString(properties.source) AS source,
  countIf(event = 'resume_upload_started')   AS s1_started,
  countIf(event = 'resume_upload_submitted') AS s2_submitted,
  countIf(event = 'resume_upload_completed') AS s3_completed,
  round(100.0 * countIf(event = 'resume_upload_completed')
        / nullIf(countIf(event = 'resume_upload_started'), 0), 2) AS overall_conversion_pct
FROM events
WHERE event IN ('resume_upload_started','resume_upload_submitted','resume_upload_completed')
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY source
ORDER BY s1_started DESC
```

### A4 — Avg / P95 Processing Time

_Dashboard A — Upload Health · processing_time_ms on completed, duplicates excluded (gap-1 fix). avg <=3000ms, P95 <=8000ms._

```sql
SELECT
  count() AS n_real_uploads,
  round(avg(toFloat(properties.processing_time_ms)), 1) AS avg_ms,
  round(quantile(0.95)(toFloat(properties.processing_time_ms)), 1) AS p95_ms
FROM events
WHERE event = 'resume_upload_completed'
  AND toString(properties.is_duplicate) = 'false'
  AND timestamp > now() - INTERVAL 7 DAY
```

### A5 — Parse Success Rate (proxy)

_Dashboard A — Upload Health · completed with sections_detected > 0 / all completed. Target >=90%._

```sql
SELECT
  count() AS completed,
  countIf(toFloat(properties.sections_detected) > 0) AS parsed_ok,
  round(100.0 * countIf(toFloat(properties.sections_detected) > 0)
        / nullIf(count(), 0), 2) AS parse_success_rate_pct
FROM events
WHERE event = 'resume_upload_completed'
  AND timestamp > now() - INTERVAL 7 DAY
```

### A6 — Avg Sections Detected

_Dashboard A — Upload Health · Healthy 4-8._

```sql
SELECT round(avg(toFloat(properties.sections_detected)), 2) AS avg_sections_detected
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
```

### A7 — Avg Bullets per Section

_Dashboard A — Upload Health · avg(bullets_total)/avg(sections_detected). Healthy 3-10._

```sql
SELECT
  round(avg(toFloat(properties.bullets_total)), 2)    AS avg_bullets,
  round(avg(toFloat(properties.sections_detected)), 2) AS avg_sections,
  round(avg(toFloat(properties.bullets_total))
        / nullIf(avg(toFloat(properties.sections_detected)), 0), 2) AS bullets_per_section
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
```

### A8 — Avg Extracted Text Length

_Dashboard A — Upload Health · avg extracted_char_count. Healthy 2,000-8,000._

```sql
SELECT round(avg(toFloat(properties.extracted_char_count)), 1) AS avg_extracted_char_count
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
```

### A9 — Failure Breakdown

_Dashboard A — Upload Health · resume_upload_failed by error_stage x error_code._

```sql
SELECT
  toString(properties.error_stage) AS error_stage,
  toString(properties.error_code)  AS error_code,
  count() AS failures
FROM events
WHERE event = 'resume_upload_failed' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY error_stage, error_code
ORDER BY failures DESC
```

### B1 — Export View Rate

_Dashboard B — Export & Engagement · export_viewed sessions / completed sessions. Target >=50% (warn <30)._

```sql
SELECT
  uniqIf(toString(properties.session_id), event = 'resume_upload_completed') AS completed_sessions,
  uniqIf(toString(properties.session_id), event = 'export_viewed')           AS export_viewed_sessions,
  round(100.0 * uniqIf(toString(properties.session_id), event = 'export_viewed')
        / nullIf(uniqIf(toString(properties.session_id), event = 'resume_upload_completed'), 0), 2) AS export_view_rate_pct
FROM events
WHERE event IN ('resume_upload_completed','export_viewed')
  AND timestamp > now() - INTERVAL 7 DAY
```

### B2 — Resume Manager Visit Rate

_Dashboard B — Export & Engagement · sessions with resume_manager_viewed / total sessions. Target >=40%._

```sql
SELECT
  uniq(toString(properties.session_id)) AS total_sessions,
  uniqIf(toString(properties.session_id), event = 'resume_manager_viewed') AS manager_sessions,
  round(100.0 * uniqIf(toString(properties.session_id), event = 'resume_manager_viewed')
        / nullIf(uniq(toString(properties.session_id)), 0), 2) AS manager_visit_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
```

### B3 — Exports Link CTR

_Dashboard B — Export & Engagement · resume_exports_link_clicked by resume_file_type._

```sql
SELECT
  toString(properties.resume_file_type) AS resume_file_type,
  count() AS clicks
FROM events
WHERE event = 'resume_exports_link_clicked' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY resume_file_type
ORDER BY clicks DESC
```

### B4 — Post-upload CTA Split

_Dashboard B — Export & Engagement · resume_upload_cta_clicked by cta (view_details vs upload_new)._

```sql
SELECT
  toString(properties.cta) AS cta,
  count() AS clicks,
  round(100.0 * count() / nullIf(sum(count()) OVER (), 0), 2) AS pct_of_clicks
FROM events
WHERE event = 'resume_upload_cta_clicked' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY cta
ORDER BY clicks DESC
```

### B5 — Export Generation Rate

_Dashboard B — Export & Engagement · completed with non-empty export_id / all completed. Expect ~100%._

```sql
SELECT
  count() AS completed,
  countIf(toString(properties.export_id) != '' AND toString(properties.export_id) != 'null') AS with_export_id,
  round(100.0 * countIf(toString(properties.export_id) != '' AND toString(properties.export_id) != 'null')
        / nullIf(count(), 0), 2) AS export_generation_rate_pct
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
```

### C1 — Return Upload Rate (30d)

_Dashboard C — Retention & Repeat Usage · users with >=2 completed uploads in 30d._

```sql
SELECT
  count() AS uploaders_30d,
  countIf(uploads >= 2) AS returning_uploaders,
  round(100.0 * countIf(uploads >= 2) / nullIf(count(), 0), 2) AS return_upload_rate_pct
FROM (
  SELECT person_id, count() AS uploads
  FROM events
  WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY person_id
)
```

### C2 — Uploads per Active User (weekly)

_Dashboard C — Retention & Repeat Usage · total completed / unique persons, 7d._

```sql
SELECT
  count() AS total_completed,
  uniq(person_id) AS active_users,
  round(count() / nullIf(uniq(person_id), 0), 2) AS uploads_per_active_user
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
```

### C3 — New vs Returning Uploaders

_Dashboard C — Retention & Repeat Usage · first-seen cohort split of uploaders._

```sql
SELECT
  multiIf(first_upload >= now() - INTERVAL 7 DAY, 'new', 'returning') AS cohort,
  count() AS uploaders
FROM (
  SELECT person_id, min(timestamp) AS first_upload
  FROM events
  WHERE event = 'resume_upload_completed'
  GROUP BY person_id
)
GROUP BY cohort
ORDER BY cohort
```

---

## What these dashboards will show on day one

**Mostly zeros, and that is correct.** PostHog project `551963` holds 5 lifetime events, all synthetic
(3 from the WIC-996 server smoke test, 2 QA probes). Zero organic traffic has ever reached it.
Only 3 of the 9 taxonomy events have ever fired; the 6 client-side ones never have, because the
app has been unreachable (WIC-1004 SPA deep-link 404, WIC-1011 plaintext HTTP), not because the
client transport is broken — WIC-1012 proved the client capture leg round-trips.

So on build day: **A1, A4-A9, B5, C2, C3 render real (synthetic) numbers; A2, A3, B1-B4, C1**
**render empty.** Empty is the honest state, not a build defect. Do not treat it as a regression,
and do not re-file the missing `$pageview` — there is no autocapture by design (hand-rolled
`/capture` wrapper, and `dashboard-spec.md` has zero pageview/UTM/referrer dependencies).

Re-check **C1-C3** once real multi-session traffic exists — they key on `person_id` and the
identity graph (WIC-822 server attribution + WIC-825 client `identify()` alias) is correct in
principle but unproven against organic users.
