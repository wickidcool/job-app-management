# Changelog

All notable changes to the Job Application Manager are documented here.

---

## [Unreleased]

> **Backfill note (2026-08-04):** Entries below reconstruct the shipped increments between UC-2 (2026-04-24) and the production launch. Each is grounded in merged commits, database migrations, and existing `docs/`. Reviewer to confirm scope and decide whether to cut a tagged production release (current `package.json` version is `0.1.0`) — the production analytics go-live below is a natural candidate for that first tag.

### Observability — Production analytics go-live (2026-08-11)

Product analytics is now **live in production**. The event sink was flipped from `noop` to **PostHog** on both tiers, so all 9 resume/export events instrumented under WIC-814 (documented in the section below) are now capturing real user data.

- **Server sink flipped** — the production Worker now runs `ANALYTICS_SINK=posthog` with `POSTHOG_API_KEY` / `POSTHOG_HOST` supplied from the GitHub `production` environment. The 3 server events (`resume_upload_started`, `resume_upload_completed`, `resume_upload_failed`) began capturing on the 2026-08-11 production deploy (WIC-821, PR #46).
- **Client sink flipped** — the production SPA build now bakes in `VITE_ANALYTICS_SINK=posthog` (plus `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`), so the 6 client events (`resume_upload_started`, `resume_upload_validation_failed`, `resume_upload_cta_clicked`, `resume_manager_viewed`, `resume_exports_link_clicked`, `export_viewed`) began capturing on the 2026-08-11 production deploy (WIC-899, PR #50). Preview builds remain `noop`.
- **Dashboards** — Dashboards A (Upload Health) and B (Export/Engagement) in `docs/analytics/dashboard-spec.md` are now fully computable from live data. Dashboard C (user-level retention) still awaits the client `identify(userId)` alias (WIC-825); until it lands, authenticated (`userId`) and pre-login (`sessionId`) events remain separate PostHog identities.

### Reliability — Boot-time credential preflight (2026-08-11)

Credentials are now validated at boot instead of failing deep in a run. A reusable, dependency-injected helper runs one cheap **authenticated** ping per configured provider and prints a structured, greppable result (`CREDENTIAL_PRECHECK_{OK,SKIP,FAIL} provider=… var=… reason=…`), naming the exact env var and provider on failure — no secret values are ever logged (WIC-878, PR #54; ADR-0001 Pillar 1).

- **Providers checked** — `github`, `anthropic`, `gemini`, `cloudflare`, `supabase`, `twilio`. `env`/`fetch`/`exec` are injected, so every path is unit-tested without the network (`packages/api/src/lib/credential-preflight.ts`).
- **GitHub env-precedence trap** — a present-but-invalid `GITHUB_TOKEN` is a hard failure even when the stored `gh` credential is valid, because env `GITHUB_TOKEN` shadows it (ADR-0001 Pillar 2, "unset beats invalid").
- **Wired into boot + CI** — runs on API server boot (opt out via `PREFLIGHT_ON_BOOT=false`) and in both CI deploy jobs, upgrading the presence-only (`-z`) checks to real authenticated pings. CLI entry: `npm run -w @wic/api preflight`.
- See `docs/architecture/CREDENTIAL_PREFLIGHT.md`.

### Fixed — Hardened credential-preflight Cloudflare & Supabase probes (2026-08-11)

The Pillar-1 preflight (above) false-failed two _valid_ least-privilege credentials on the first live production run, blocking the deploy. Both probes were hardened — per the WIC-910 EM directive the fix is to **harden** the check, not remove it — so a correctly-scoped token/key is no longer punished (WIC-903, PR #59, merged `191865c`).

- **Cloudflare probe — account-scoped token trap.** The check pinged the user-scoped `GET /user/tokens/verify`, which returns `401` (code 1000 "Invalid API Token") for an **account-scoped, least-privilege** Workers+R2 deploy token — the correct CI token. The probe now verifies against the **account-scoped** `GET /accounts/{id}/tokens/verify` when `CLOUDFLARE_ACCOUNT_ID` is set (HTTP 200 → parse `result.status`: `active` = ok, `disabled`/`expired` = fail `token-inactive`; `401`/`403` = fail `unauthorized`). With no account id it falls back to the user endpoint but treats a `401`/`403` there as **advisory** (`SKIP`, reason `advisory-unverified`) rather than a hard fail.
- **Supabase probe — publishable-key trap.** The check pinged the PostgREST root `GET /rest/v1/`, which under Supabase's current API-key format accepts only **secret** keys — a valid new-style **publishable** key (`sb_publishable_…`) is rejected there with `401` "Secret API key required". The probe now pings GoTrue `GET {SUPABASE_URL}/auth/v1/settings`, which validates both legacy anon JWTs and new publishable keys (clean `200`/`401`); a deleted/paused project still surfaces as a network/DNS error against `SUPABASE_URL`.
- **CI — advisory-first re-adoption.** The `preflight -- cloudflare supabase` step was re-added to both preview and production deploy jobs as **advisory** (`continue-on-error: true`) and now passes `CLOUDFLARE_ACCOUNT_ID` so the CF check uses the account-scoped endpoint. To be flipped to a hard gate once green across live dev/prod runs.
- See the "account-scoped-token trap" and "publishable-key trap" sections of `docs/architecture/CREDENTIAL_PREFLIGHT.md`.

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

### Security — Secret-material CI lint (ADR-0001 Pillar 3, 2026-08-08)

- **Secret scanner:** new `npm run scan:secrets` CI step fails the build when secret-shaped
  material (API keys, tokens, PEM private keys) appears in a committed **non-secret field** —
  binding names, resource names, labels, or any tracked file. Cheap insurance against a repeat
  of the WIC-751 leak, where an Anthropic key rode in as a Worker binding name (WIC-879).
- Prefix/shape patterns for `ghp_`, `github_pat_`, `sk-ant-`, `AIza`, AWS/Slack/Twilio/Cloudflare
  tokens, plus a conservative high-entropy heuristic on config/manifest files only (ignores
  ids/SHAs/URLs to stay low false-positive). Findings point at `file:line:col` + field and are
  redacted — the scanner never echoes the raw secret.
- False positives handled via inline `secret-scan:allow` pragma or `.github/secret-scan-allowlist.json`.
  See `docs/architecture/secret-scan.md`. Pure core in `packages/api/src/lib/secret-scan.ts` (14 unit tests).

### Security — Credential precedence contract & registry (ADR-0001 Pillars 2 & 4, 2026-08-08)

Two canonical, **metadata-only** docs now govern how the fleet resolves and tracks every credential — the doc half of ADR-0001. No secret values are stored; both files are committed and covered by the Pillar 3 secret-scan (WIC-880, PR #63).

- **Precedence & provenance contract (Pillar 2)** — `docs/architecture/CREDENTIAL_PRECEDENCE.md` names one **authoritative source** per credential and a defined precedence order for its derived copies. Three rules: (1) one authoritative source, all other locations are derived copies reconciled _to_ it; (2) **`unset` beats `invalid`** — an absent source falls through, but a present-but-invalid one is a hard failure, never silently overridden (the WIC-855/859 GitHub env-shadow class); (3) no secret is ever set to a placeholder value. The executable half of this contract already ships in the Pillar 1 preflight's `GITHUB_TOKEN` env-shadow check.
- **Credential registry (Pillar 4)** — `docs/architecture/CREDENTIAL_REGISTRY.md` is the canonical inventory: one row per credential with owner, least-privilege required scopes, rotation cadence, next-review/expiry date, and authoritative source. Seeded for the four ADR-named providers (GitHub, Cloudflare, Supabase, Anthropic) plus incident-history providers (Gemini, Twilio) and emerging (PostHog). The scope column is the provisioning checklist that catches the WIC-869 Cloudflare mis-scope class; every row carries a review date so stale/mispointed creds (WIC-863/868 Supabase) surface on schedule.
- Both are linked from ADR-0001 and cross-linked with `docs/architecture/CLOUD_ENV_SECRETS.md` (env-var locations per environment).

### Security — Multi-user authentication & tenant isolation (2026-04-30 → 2026-05-05)

The app became multi-tenant. When Supabase env vars are set, all `/api/*` endpoints require a valid JWT.

- **Supabase JWT auth middleware**, backend-only (no frontend Supabase SDK) (WIC-197, WIC-193)
- **ES256 / JWKS verification** — verify Supabase JWTs against the project JWKS, not just the shared secret (WIC-233)
- **Route-level user isolation** — every endpoint scopes queries to the authenticated `user_id`; `NOT NULL` enforced with per-user indexes (WIC-213, WIC-196; migrations `0011`, `0017`)
- **Row-Level Security** policies on Supabase (`supabase/migrations/0001_rls_user_isolation.sql`)
- Removed unauthenticated `/api/resumes/test-api-key` debug endpoint (WIC-216); removed a PII-leaking raw-text upload log
- Auto-logout on `401` responses (WIC-280); auth UI implemented with Supabase (WIC-199)
- See `docs/AUTHENTICATION.md` and `ADR-003-multi-user-auth`.

### Observability — Product analytics instrumentation & event taxonomy (2026-08-04)

The resume-upload and export flows are now instrumented against the KPIs in `docs/analytics/metrics-baseline.md`, feeding the PostHog dashboards spec'd in `docs/analytics/dashboard-spec.md` (WIC-814, WIC-815, WIC-817).

- **Server-side capture** (`packages/api/src/services/analytics.service.ts`) — a pluggable sink selected by `ANALYTICS_SINK` (`noop` default | `console` | `posthog`); the PostHog sink posts to the `/capture` HTTP endpoint, which works from Cloudflare Workers over `fetch`. A failed capture never throws or breaks the request path.
- **Attribution** — authenticated events now attribute to the user: `distinct_id = userId ?? session_id ?? anonymous` (WIC-822, merged). The raw `session_id` is still retained as an event property, so per-session funnels keep working and pre-login events remain session-scoped. This closes the server-side half of "Gap 2" in `docs/analytics/dashboard-spec.md`; two follow-ups remain before user-level retention KPIs (Dashboard C) fully light up: a client `identify(userId)` alias so pre-login events fold into the user identity (WIC-825), and the prod PostHog sink flip (WIC-821). Until those land, authed (`userId`) and pre-login (`sessionId`) events are two separate PostHog identities.
- **Event taxonomy:**
  - Server (`@wic/api`): `resume_upload_started`, `resume_upload_completed` (carries an `is_duplicate` boolean so P95 processing-time and funnel KPIs can exclude re-uploads — WIC-817), `resume_upload_failed`.
  - Client (`@wic/web`, `packages/web/src/services/analytics.ts`): `resume_upload_started`, `resume_upload_validation_failed`, `resume_upload_cta_clicked`, `resume_manager_viewed`, `resume_exports_link_clicked`, `export_viewed`.
- **Config** — `ANALYTICS_SINK` + `POSTHOG_API_KEY` / `POSTHOG_HOST` on the Worker; `VITE_ANALYTICS_SINK` + `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` on the web build (see each package's `.env.example`).
- Coverage: `packages/api/test/analytics.service.test.ts`. See `docs/analytics/metrics-baseline.md` and `docs/analytics/dashboard-spec.md`.

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
