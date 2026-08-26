# Job Application Manager — Architecture Overview

## Executive Summary

CareerPin (the Job Application Manager) is a **cloud-hosted, multi-tenant web application**. The API is a [Hono](https://hono.dev) app running on **Cloudflare Workers**; persistence is **Supabase Postgres** reached through Drizzle ORM; documents live in **Cloudflare R2**; and authentication is a **Supabase-issued JWT presented as a bearer token**.

The application was originally designed local-first — a Node.js/Fastify server, a PostgreSQL instance on `localhost`, and documents on the local filesystem. **None of that is still true.** There is no Fastify dependency in the tree, no local data directory, and no session-cookie auth. See [Historical note](#historical-note-the-local-first-origins) for where that design is recorded.

## Scope of this document

This is the **current-state** overview: what runs in production today, and how a request flows through it.

Two neighbouring documents are deliberately *not* superseded by this one:

| Document | What it is |
|---|---|
| [CLOUDFLARE_WORKERS_ARCHITECTURE.md](./CLOUDFLARE_WORKERS_ARCHITECTURE.md) | The **migration plan** — Fastify→Hono route patterns, phases, rollback. A historical record of the move, not of the destination. |
| [API_CONTRACTS.md](./API_CONTRACTS.md) | The **endpoint specification** — request/response shapes, status codes, pagination. |

Where this document and the source disagree, the source wins; please fix this document.

## System topology

Three hostnames on the `careerpin.app` Cloudflare zone:

```
                            ┌──────────────────────────┐
   careerpin.app            │  Marketing site          │
   www.careerpin.app  ─────▶│  packages/marketing      │  static HTML/CSS/JS
                            │  (+ _worker.js)          │
                            └──────────────────────────┘

                            ┌──────────────────────────────────────────────┐
                            │  Cloudflare Workers  —  worker `jobtrail`    │
                            │                                              │
                            │  ┌────────────────────────────────────────┐  │
   app.careerpin.app ──────▶│  │ Static asset router (binding `ASSETS`) │  │
                            │  │ `/`, `/assets/*`, `/favicon.svg`       │  │
                            │  │ serves packages/web/dist (React SPA)   │  │
                            │  │ — answers BEFORE the Worker runs       │  │
                            │  └────────────────────────────────────────┘  │
                            │                    │ everything else         │
                            │                    ▼                         │
                            │  ┌────────────────────────────────────────┐  │
                            │  │ Worker: packages/api/src/worker.ts     │  │
                            │  │   securityHeaders() → httpsRedirect()  │  │
                            │  │   → cors → GET /health                 │  │
                            │  │   → /api/* (authMiddleware → routes)   │  │
                            │  │   → notFound: SPA shell or JSON 404    │  │
                            │  └────────────────────────────────────────┘  │
                            └──────────────────────────────────────────────┘
                                      │                          │
                          ┌───────────┘                          └───────────┐
                          ▼                                                  ▼
              ┌───────────────────────────┐                    ┌───────────────────────────┐
              │  Supabase Postgres        │                    │  Cloudflare R2            │
              │  drizzle-orm/postgres-js  │                    │  binding `R2_BUCKET`      │
              │  (Hyperdrive-ready)       │                    │  resumes, cover letters,  │
              │  + Supabase Auth (JWT)    │                    │  generated documents      │
              └───────────────────────────┘                    └───────────────────────────┘
```

The asset router answering `/` and `/assets/*` **before** the Worker is load-bearing, not a detail: response headers for those paths cannot be set in Worker code, which is why `packages/web/public/_headers` exists and why the zone-level `Always Use HTTPS` setting had to close the first-contact gap. See the "App-host transport hardening" entry in [CHANGELOG.md](../../CHANGELOG.md).

## Repository layout

An npm-workspaces monorepo (`"workspaces": ["packages/*"]`):

| Path | Workspace | Contents |
|---|---|---|
| `packages/api` | `@wic/api` | Hono API, Worker entry, Drizzle schema + migrations, services |
| `packages/web` | `@wic/web` | React 18 + Vite SPA; `dist/` is the Worker's `assets.directory`, exposed as the `ASSETS` binding |
| `packages/marketing` | — | Static marketing site for the apex/`www` hosts (plain HTML/CSS/JS + `_worker.js`) |
| `packages/infra` | — | `redirect-worker/` and `redirect-pages/` — hostname redirect shims |

`packages/marketing` and `packages/infra` have no `package.json`; they are deployed as static assets, not built as workspaces.

## Technology stack

| Layer | Technology | Notes |
|---|---|---|
| **Runtime** | Cloudflare Workers | `compatibility_date` `2026-05-05`, `compatibility_flags: ["nodejs_compat"]` |
| **API framework** | Hono 4.7 | `@hono/node-server` for the local Node path |
| **Frontend** | React 18, TypeScript, Vite | Served as Worker static assets |
| **Database** | Supabase Postgres | `postgres` (postgres-js) driver |
| **ORM** | Drizzle ORM 0.30 | Migrations via `drizzle-kit` |
| **Connection pooling** | Cloudflare Hyperdrive | Bound in `preview` only; production uses the Supabase transaction pooler (see below) |
| **Document storage** | Cloudflare R2 | Native binding, with an S3-API fallback |
| **Auth** | Supabase Auth + `jose` 6 | JWT verified in the Worker |
| **Validation** | Zod 3 | |
| **Identifiers** | ULID | |
| **LLM** | `@anthropic-ai/sdk` | Resume parsing, cover letters, job-fit, interview prep |
| **Document parsing** | `pdf-parse`, `pdfjs-dist`, `mammoth`, `docx` | PDF/DOCX in and out |
| **Tests** | Vitest (unit), Playwright (E2E) | |

## Request lifecycle

`packages/api/src/worker.ts` is the Worker entry point; `packages/api/src/app.ts` builds the Hono app.

1. **Worker fetch handler** wraps every request in `runWithEnv(env, …)`, which establishes a per-request context holding the Workers `env` and a cached SQL connection.
2. **Hyperdrive-timeout retry** — the handler retries up to **3 attempts** on a recognised Hyperdrive timeout, backing off `50ms × attempt`. Each attempt gets a *fresh* request context, so a retry never reuses a broken connection. On exhaustion it returns `503` with `{"error":{"code":"SERVICE_UNAVAILABLE"}}` and `Retry-After: 1`.
3. **`securityHeaders()`** then **`httpsRedirect()`**, both on `*`, run before any handler.
4. **CORS** middleware.
5. **`GET /health`** is registered on the root app — **outside** the `/api` mount, and therefore unauthenticated. It reports `{ status, hyperdrive, db }`, returning `200` when healthy and `503` when degraded. The database is probed only when a `HYPERDRIVE` binding or `DATABASE_URL` is present; otherwise `db` is `"not_applicable"` so local and test runs do not fail the check.
6. **`/api/*`** is a sub-app with `authMiddleware` on `*`, into which thirteen route modules are mounted at `/`: `auth`, `applications`, `dashboard`, `cover-letters`, `resumes`, `projects`, `dialogue`, `catalog`, `reports`, `resume-variants`, `interview-preps`, `onboarding`, `personal-info`.
7. **`app.notFound`** is the SPA fallback (WIC-1004), and it is more careful than "serve index.html":
   - Unmatched `/api` or `/api/*` returns JSON `404 NOT_FOUND` — API paths never receive HTML.
   - With no `ASSETS` binding, or for a method other than `GET`/`HEAD`, it returns a plain-text `404`.
   - Otherwise it calls `ASSETS.fetch()`, then explicitly retries `/index.html` on a miss, so the shell is still served if `not_found_handling` ever drifts.
   - It **refuses** the shell for build-owned paths and for file-extension subresource requests that are not navigations. This matters: under `single-page-application` handling a miss comes back as the shell with `200`, so a stale hashed bundle still referenced by a cached `index.html` would blank the page on the browser's module MIME check instead of failing cleanly — and would never appear as a `404` in monitoring. Those requests get a real `404` instead.

## Authentication

Implemented in `packages/api/src/middleware/auth.ts`.

- Callers present a Supabase JWT as **`Authorization: Bearer <token>`**. A missing or non-`Bearer` header is `401 UNAUTHORIZED`.
- **Public paths** — `/api/auth/login`, `/api/auth/register`, `/api/auth/logout` — skip verification. `GET /health` is exempt by construction, being outside the `/api` mount.
- **Verification** uses `jose`. Remote JWKS fetchers are cached per issuer (`<issuer>/.well-known/jwks.json`) so the fetcher is not rebuilt per request.
- **Local bypass** — auth is skipped, with `userId` set to `null`, only when **both** `SUPABASE_URL` **and** `SUPABASE_JWT_SECRET` are absent. Supplying just one does *not* disable auth. This exists so `npm run dev:api` works without Supabase credentials.
- Verified requests carry `userId` for the rest of the request; tenant scoping is enforced in the service layer and by Postgres Row-Level Security.

## Data layer

`packages/api/src/db/client.ts` resolves a connection through three paths, in order:

| Condition | Behaviour |
|---|---|
| `env.HYPERDRIVE` present | `postgres(HYPERDRIVE.connectionString, { prepare: false })` — Hyperdrive owns pooling |
| `env.DATABASE_URL` present | `postgres(DATABASE_URL, { prepare: false, ssl: 'require' })` — one connection per request, cached on the request context and reused across service calls |
| Neither (Node.js) | Module-level singleton; `ssl: 'require'` and `max: 10` for Supabase hosts, otherwise `ssl: false` and `max: 5` for local Docker |

`prepare: false` is required on both Workers paths — prepared statements do not survive a pooled/serverless connection.

**Which path runs where:** the `preview` environment declares a real `HYPERDRIVE` binding in `wrangler.jsonc`, so preview takes path 1. **Production declares no Hyperdrive binding** and therefore takes path 2, with `deploy.yml` supplying a `DATABASE_URL` that points at the Supabase **transaction pooler on port 6543**. Path 3 is local `npm run dev:api` only.

Schema and table documentation live in [DATA_MODEL.md](./DATA_MODEL.md).

## Document storage

`packages/api/src/services/storage.service.ts` writes resumes, cover letters and generated documents to R2 by one of two paths:

- **Workers** — the native `R2_BUCKET` binding (`.put()` / `.get()` / `.delete()` / `.list()`).
- **Node.js / local** — an `S3Client` against R2's S3-compatible API, with `@aws-sdk/s3-request-presigner` for signed URLs (default expiry 3600s).

`isR2Configured()` / `isStorageAvailable()` let callers degrade gracefully when neither path is available.

## Environments

**The deployed configuration is the repository-root [`wrangler.jsonc`](../../wrangler.jsonc).** `deploy.yml` invokes `cloudflare/wrangler-action` with `command: deploy` from the repo root and no `--config`, so that file — not `packages/api/wrangler.toml` — is what ships:

| Environment | Worker name | R2 bucket | Hyperdrive |
|---|---|---|---|
| production (top level) | `jobtrail` | `jobtrail-documents` | none — Supabase pooler via `DATABASE_URL` |
| `preview` (PR deploys) | `jobtrail-preview` | `jobtrail-documents-dev` | bound |

> ⚠️ `packages/api/wrangler.toml` is a **second, divergent config that never deploys**. It names different Workers (`jobapp-api`, `jobapp-api-dev`, `jobapp-api-staging`), pins `compatibility_date = "2024-01-01"`, declares no static assets, and carries Hyperdrive only as a commented-out template. Read the root `wrangler.jsonc` for anything authoritative.

Non-secret config lives in `vars` — `NODE_ENV`, and the analytics sink `ANALYTICS_SINK: "posthog"` with `POSTHOG_HOST` (WIC-821). Workers observability is enabled.

Secrets are never in `vars`; they are injected at deploy time by `wrangler-action` and stored with `wrangler secret put` / `secret bulk`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `POSTHOG_API_KEY`. If `POSTHOG_API_KEY` is unset, `config.ts` and `analytics.service.ts` fall back to a no-op sink with a warning rather than failing. The credential rules are binding — see [ADR-0001](./adr/ADR-0001-fleet-secrets-credential-management.md), [CREDENTIAL_PRECEDENCE.md](./CREDENTIAL_PRECEDENCE.md) and [CLOUD_ENV_SECRETS.md](./CLOUD_ENV_SECRETS.md).

CI/CD lives in `.github/workflows/` — `deploy.yml` (lint/test, preview deploys, production deploy plus migrations, and a manual dispatch lever for rollback) and `deploy-marketing.yml`, alongside secret-scanning and Supabase-keepalive workflows. See [CI_CD.md](./CI_CD.md).

## Local development

```bash
npm install

npm run dev          # SPA (Vite) — packages/web
npm run dev:api      # API on Node via @hono/node-server
npm run dev:worker   # API on workerd via `wrangler dev` (closest to production)

npm run db:migrate   # Drizzle migrations
npm run typecheck    # tsc -b packages/web packages/api --noEmit
npm run test         # Vitest across workspaces
npm run test:e2e     # Playwright
```

`npm run dev:api` runs without Supabase credentials — see the local bypass rule under [Authentication](#authentication). Use `dev:worker` when behaviour depends on bindings, since only workerd provides `R2_BUCKET` and `HYPERDRIVE`.

> `npm run format` is scoped to `packages/**` on purpose. Do **not** run Prettier over `docs/`; it reflows every table and manufactures merge conflicts.

## Security posture

| Concern | Approach |
|---|---|
| **Transport** | `httpsRedirect()` (`301`/`308`) plus zone-level `Always Use HTTPS`; HSTS `max-age=31536000; includeSubDomains`, `preload` withheld |
| **Response headers** | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `CSP: frame-ancestors 'none'` — from the Worker and from `_headers` for asset-router paths |
| **Authentication** | Supabase JWT, verified per request in the Worker |
| **Tenant isolation** | `userId` scoping in the service layer **and** Postgres Row-Level Security |
| **Input validation** | Zod schemas at the route boundary |
| **SQL injection** | Parameterised queries via Drizzle |
| **Secret handling** | `wrangler secret put` only; CI secret-scanning; ADR-0001 prohibits secret material in client/build vars |

## Historical note: the local-first origins

Through 2026-04 the application was a local-first desktop-style tool: Fastify on `localhost:3000`, PostgreSQL on `localhost:5432`, documents under `./data/`, and optional cookie-session auth. The cloud migration (WIC-217, WIC-222, WIC-223) replaced all of it in 2026-05.

That design is not preserved here — this file now documents the deployed system. The migration itself is recorded in [CLOUDFLARE_WORKERS_ARCHITECTURE.md](./CLOUDFLARE_WORKERS_ARCHITECTURE.md), [ADR-004: Cloud migration](./adr/ADR-004-cloud-migration-supabase-cloudflare.md) and [ADR-006: Hono on Workers](./adr/ADR-006-hono-framework-workers.md); the pre-migration reasoning survives in [ADR-001: Database Selection](./adr/ADR-001-database-selection.md), whose "local installation" rationale should be read as history.

## References

- [API Contracts](./API_CONTRACTS.md)
- [Data Model](./DATA_MODEL.md)
- [Cloudflare Workers migration](./CLOUDFLARE_WORKERS_ARCHITECTURE.md)
- [CI/CD](./CI_CD.md)
- [Cloud environment secrets](./CLOUD_ENV_SECRETS.md)
- [Authentication guide](../AUTHENTICATION.md)
- [ADR-004: Cloud migration to Supabase + Cloudflare](./adr/ADR-004-cloud-migration-supabase-cloudflare.md)
- [ADR-006: Hono framework on Workers](./adr/ADR-006-hono-framework-workers.md)
- [UI/UX design specs](../design/)
