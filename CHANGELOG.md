# Changelog

All notable changes to the Job Application Manager are documented here.

---

## [Unreleased]

> **Backfill note (2026-08-04):** Entries below reconstruct the shipped increments between UC-2 (2026-04-24) and the production launch. Each is grounded in merged commits, database migrations, and existing `docs/`. Reviewer to confirm scope and decide whether to cut a tagged production release (current `package.json` version is `0.1.0`).

### Added — Analytics instrumentation & event taxonomy (2026-08-04)

Product-analytics instrumentation for the resume upload/manager/export flows, wired behind a provider-agnostic wrapper. **Emits nothing until a sink is explicitly configured** — both wrappers default to a no-op, so production stays dark until `ANALYTICS_SINK=posthog` is set (tracked separately; the PostHog production flip is not part of this change).

- **Canonical 9-event taxonomy** (`resume_upload_started`, `_validation_failed`, `_submitted`, `_completed`, `_failed`, `_cta_clicked`, `resume_manager_viewed`, `resume_exports_link_clicked`, `export_viewed`) with typed property schemas. The server owns the three `submitted / completed / failed` events; the client owns the other six. Event names and property shapes are defined by the board-approved `docs/analytics/metrics-baseline.md` §3.
- **Server wrapper** `packages/api/src/services/analytics.service.ts` — pluggable `AnalyticsSink` (`noop` / `console` / `posthog`), PostHog delivery via the `/capture` HTTP endpoint (Workers-compatible `fetch`, no SDK). Sinks never throw, so analytics can't break the request path (WIC-814).
- **Client wrapper** `packages/web/src/services/analytics.ts` — mirrors the server wrapper; a per-browser `session_id` (persisted in `sessionStorage`) is stamped on every client event and sent as the `X-Session-Id` header on uploads so client + server events correlate into one funnel (WIC-815).
- **Configuration** — server: `ANALYTICS_SINK` (default `noop`), `POSTHOG_API_KEY`, `POSTHOG_HOST` (default `https://us.i.posthog.com`); client: `VITE_ANALYTICS_SINK`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`.
- See `docs/analytics/metrics-baseline.md` (event taxonomy + KPI definitions) and `docs/analytics/dashboard-spec.md`.

### Infrastructure — Cloud migration to Cloudflare Workers + Supabase (2026-05-05)

The application moved from a local-first Fastify/PostgreSQL stack to a serverless production deployment.

- **API framework:** migrated from Fastify to **Hono** to run on Cloudflare Workers (WIC-222; `ADR-006-hono-framework-workers`)
- **Deployment config:** Cloudflare Workers via `wrangler.jsonc`, SPA asset serving with `not_found_handling` (WIC-223, WIC-234)
- **Document storage:** migrated resume/cover-letter file storage from the local filesystem to **Cloudflare R2** (WIC-217, WIC-198; `ADR-004-cloudflare-r2-storage`). Buckets renamed `jobapp-documents` → `jobtrail-documents`.
- **Database connectivity:** production connects to **Supabase Postgres** via the transaction pooler; PDF parsing switched from `pdf-parse` to `pdfjs-dist` (legacy build) for Workers compatibility (WIC-235)
- **Health checks:** `/health` endpoint gained a database probe; deploys run a pre-deploy secret-validation step (WIC-234)
- See `docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md`, `docs/architecture/CLOUD_MIGRATION_SCHEMA.md`, and `docs/architecture/CLOUD_ENV_SECRETS.md`.

### Infrastructure — CI/CD pipeline + production deploy (2026-05-02 → 2026-08)

- **GitHub Actions** CI/CD pipeline: lint, test, preview deploys per PR, and production deploy on merge to `main` (WIC-200, WIC-564; `ADR-005-github-actions-cicd`, `docs/architecture/CI_CD.md`)
- Preview deploys run DB migrations and E2E tests; production DB migrations run over the Supabase transaction pooler (WIC-564)
- Hardened `SUPABASE_DATABASE_URL` handling — fail fast on non-PostgreSQL URLs, configurable pooler region (WIC-633, WIC-638)

### Security — Multi-user authentication & tenant isolation (2026-04-30 → 2026-05-05)

The app became multi-tenant. When Supabase env vars are set, all `/api/*` endpoints require a valid JWT.

- **Supabase JWT auth middleware**, backend-only (no frontend Supabase SDK) (WIC-197, WIC-193)
- **ES256 / JWKS verification** — verify Supabase JWTs against the project JWKS, not just the shared secret (WIC-233)
- **Route-level user isolation** — every endpoint scopes queries to the authenticated `user_id`; `NOT NULL` enforced with per-user indexes (WIC-213, WIC-196; migrations `0011`, `0017`)
- **Row-Level Security** policies on Supabase (`supabase/migrations/0001_rls_user_isolation.sql`)
- Removed unauthenticated `/api/resumes/test-api-key` debug endpoint (WIC-216); removed a PII-leaking raw-text upload log
- Auto-logout on `401` responses (WIC-280); auth UI implemented with Supabase (WIC-199)
- See `docs/AUTHENTICATION.md` and `ADR-003-multi-user-auth`.

### Added — Onboarding wizard & Personal Information (2026-05-08 → 2026-05-12)

- **Onboarding flow**: guided multi-step wizard (resume upload → personal info → app overview) with step-state persistence (WIC-237, WIC-242, WIC-244; migrations `0012`, `0015`; `docs/design/ONBOARDING_FLOW.md`)
- **Personal Information**: `/api/personal-info` endpoints + React components; LinkedIn URL required (WIC-251, WIC-252; migrations `0013`–`0016`; `docs/architecture/PERSONAL_INFO_API.md`)

### Added — UC-7: Interview Prep (2026-04-29)

- **Interview Prep API** (`/api/interview-preps`) and a 5-component UI: STAR story bank, likely questions, and prep guidance (WIC-168, WIC-169; migration `0009_interview_prep.sql`)

### Added — UC-6: Resume Variant Generation (2026-04-28)

- Generate **targeted resume variants** from a base resume against a job description, with rebalance and one-page-compression modes (WIC-153; migration `0008_resume_variants.sql`)
- Export to Markdown / DOCX / PDF (DOCX base64→Uint8Array fix, WIC-158)
- See `docs/architecture/UC-6_RESUME_VARIANT_API.md`.

### Added — UC-5: Extended Application Tracking & Reports (2026-04-27)

- Extended application fields (contacts, next-action due dates, job description) and dedicated **report pages** (WIC-146; migrations `0007`, `0010`)
- Kanban/pipeline improvements, filter panel, global search, breadcrumbs, and mobile UX passes (WIC-171, WIC-177, WIC-178, WIC-179, WIC-295)

### Added — UC-4: Cover Letter Generation (2026-04-26)

- Generate and revise **cover letters** (base draft, revise existing, short-form outreach) wired into the fit-analysis → cover-letter workflow (PR #12, WIC-161; migrations `0005_cover_letters_schema.sql`, `0006_cover_letters_emphasis.sql`)

### Added — UC-3: Dialogue Capture Wizard (2026-04-23)

- Conversational **dialogue capture** wizard UI + API to elicit STAR stories and experience details (WIC-97, WIC-98; `docs/design/DIALOGUE_CAPTURE_WIZARD.md`)

### Added — Job Fit Analysis (2026-04-25)

- **Job Fit Analysis** endpoint (`/api/job-fit`) scoring a resume against a job description, with LLM-powered JD parsing and a regex fallback (WIC-116; `ADR-003-job-fit-api-design`)
- Configurable `LLM_MODEL` env var wired into `LLMService`

### Added — Local-first Projects & AI Resume Parser (2026-04-20 → 2026-04-21)

- **Project files** REST API + CRUD UI with Markdown editing (WIC-67, WIC-68, WIC-69)
- **AI-powered resume parser** using Claude — streaming extraction of STAR items, experience, education, and skills (WIC-71, WIC-72)
- **Duplicate resume detection** via content hashing (WIC-292; migration `0018_resume_content_hash.sql`)

### Added — CareerPin marketing site & domain pivot (2026-06)

- CareerPin marketing site pages and host-based 301 redirects on Cloudflare Pages; product pivot to the `careerpin.app` domain (WIC-507, WIC-522)

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

| Table                | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `company_catalog`    | Deduplicated company index with application counts       |
| `tech_stack_tags`    | Technology skill tags with category and legacy flags     |
| `job_fit_tags`       | Role/industry/seniority signal tags                      |
| `quantified_bullets` | Extracted metric achievements with impact classification |
| `recurring_themes`   | Career themes with core-strength promotion               |
| `catalog_diffs`      | Pending change diffs with 7-day expiry                   |
| `catalog_change_log` | Immutable audit trail of all catalog mutations           |
| `wikilink_registry`  | Resolved `[[wikilink]]` → catalog entity mappings        |

New enum types: `job_fit_category`, `tech_stack_category`, `metric_type`, `impact_category`, `change_action`, `diff_status`

#### Documentation

- `docs/architecture/API_CONTRACTS.md` — Catalog endpoint reference with schemas and error codes
- `docs/architecture/DATA_MODEL.md` — Catalog table definitions, enum values, wikilink resolution, and core-strength promotion rules
- `docs/design/USER_FLOWS.md` — UC-2 user flows: browse catalog, diff review, ambiguity resolution, expiry, and curation
