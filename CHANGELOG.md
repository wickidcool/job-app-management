# Changelog

All notable changes to the Job Application Manager are documented here.

---

## [Unreleased]

### Added — UC-2: Master Catalog Index (2026-04-24)

A normalized, queryable knowledge base of professional attributes automatically extracted from resumes and applications, with human-in-the-loop review for ambiguous or uncertain extractions.

#### Features

**Catalog API** (`/api/catalog/*`)
- `GET/POST /catalog/diffs` — list and generate extraction diffs
- `GET /catalog/diffs/:id` — retrieve full diff with changes and review items
- `POST /catalog/diffs/:id/apply` — approve all, reject all, or make partial decisions
- `POST /catalog/diffs/:id/resolve` — resolve a single change or review item
- `DELETE /catalog/diffs/:id` — discard a pending diff
- `GET /catalog/companies`, `POST /catalog/companies/merge` — browse and deduplicate company entries
- `GET /catalog/tags/:type`, `PATCH /catalog/tags/:type/:id`, `POST /catalog/tags/:type/merge` — manage job-fit and tech-stack tags
- `GET /catalog/quantified-bullets` — browse extracted metric achievements by impact category
- `GET /catalog/themes` — browse recurring career themes, with core-strength promotion at 3+ occurrences

**Extraction engine** (`extraction.service.ts`)
- Detects 60+ known technologies with aliases and legacy flags (e.g. jQuery, CoffeeScript)
- Extracts 14 job-fit signal patterns across role, industry, seniority, and work style
- Identifies 9 recurring career theme patterns
- Parses quantified bullet points with dual-metric support and approximate-value detection
- Resolves `[[wikilink]]` patterns against the `wikilink_registry` for cross-reference linking
- Flags ambiguous values (`PM`, fuzzy matches) as `ReviewItem` entries for human resolution

**Diff Review UI** (`/catalog` route)
- Tab-based Catalog browse page: Pending Diffs, Companies, Tech Stack, Job Fit, Quantified Bullets, Themes
- `DiffReviewModal` — approve all, reject all, or selectively apply individual changes
- `AmbiguityResolver` — radio-button UI for resolving ambiguous tags, fuzzy matches, and unresolved wikilinks
- `ChangeListItem` — before/after diff display with checkbox selection and action badges (CREATE / UPDATE / DELETE)

#### Database

New tables added via migration `0004_catalog_schema.sql`:

| Table | Purpose |
|-------|---------|
| `company_catalog` | Deduplicated company index with application counts |
| `tech_stack_tags` | Technology skill tags with category and legacy flags |
| `job_fit_tags` | Role/industry/seniority signal tags |
| `quantified_bullets` | Extracted metric achievements with impact classification |
| `recurring_themes` | Career themes with core-strength promotion |
| `catalog_diffs` | Pending change diffs with 7-day expiry |
| `catalog_change_log` | Immutable audit trail of all catalog mutations |
| `wikilink_registry` | Resolved `[[wikilink]]` → catalog entity mappings |

New enum types: `job_fit_category`, `tech_stack_category`, `metric_type`, `impact_category`, `change_action`, `diff_status`

#### Documentation

- `docs/architecture/API_CONTRACTS.md` — Catalog endpoint reference with schemas and error codes
- `docs/architecture/DATA_MODEL.md` — Catalog table definitions, enum values, wikilink resolution, and core-strength promotion rules
- `docs/design/USER_FLOWS.md` — UC-2 user flows: browse catalog, diff review, ambiguity resolution, expiry, and curation
