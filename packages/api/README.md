# @wic/api — Hono Backend

The backend for the Job Application Manager. A single [Hono](https://hono.dev) app that
runs both as a **Cloudflare Worker** (production and `wrangler dev`) and on **Node.js**
(fast local iteration via `@hono/node-server`). It serves the `/api/*` routes; in
production the same Worker also serves the built React SPA.

Backed by **Supabase PostgreSQL** (reached through a Cloudflare **Hyperdrive** connection
pool at the edge, via Drizzle ORM) and **Cloudflare R2** for document storage.

See [`docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md`](../../docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md)
for the full picture and [`ADR-006`](../../docs/architecture/adr/ADR-006-hono-framework-workers.md)
for why Hono replaced the original Fastify backend.

## Quick Start

Everything is driven from the repo root (npm workspaces) — you rarely `cd` into this
package.

### 1. Install dependencies

```bash
# From the repo root
npm install
```

### 2. Configure secrets

Local dev secrets live in `.dev.vars` at the repo root (loaded automatically by
`wrangler dev`). Copy the example and fill in values:

```bash
cp .dev.vars.example .dev.vars
```

All values are optional for a bare local run: with no Supabase config the auth
middleware bypasses (single-user/local), and AI features are simply disabled when
`ANTHROPIC_API_KEY` is unset. See [Environment & Secrets](#environment--secrets) below.

### 3. Run the API

Two local modes, depending on what you need:

```bash
# Node.js runtime via tsx — fastest iteration, hot reload, listens on :3000
npm run dev:api

# Cloudflare Workers runtime via wrangler dev — emulates R2 + Hyperdrive bindings,
# closest to production
npm run dev:worker
```

`npm run dev:api` serves the API at `http://localhost:3000/api`. Health check:
`http://localhost:3000/health`.

## API Endpoints

Routes are grouped by domain and mounted under `/api` (see `src/app.ts`). Auth endpoints
(`/api/auth/*`) are public where noted; everything else requires a valid JWT when Supabase
auth is configured.

| Method | Path                           | Description                        |
| ------ | ------------------------------ | ---------------------------------- |
| GET    | `/health`                      | Health check (DB probe when bound) |
| POST   | `/api/auth/register`           | Register (public)                  |
| POST   | `/api/auth/login`              | Log in (public)                    |
| POST   | `/api/auth/logout`             | Log out (public)                   |
| GET    | `/api/auth/me`                 | Current user                       |
| GET    | `/api/applications`            | List applications (with filtering) |
| GET    | `/api/applications/:id`        | Get application + status history   |
| POST   | `/api/applications`            | Create application                 |
| PATCH  | `/api/applications/:id`        | Update application fields          |
| DELETE | `/api/applications/:id`        | Delete application                 |
| POST   | `/api/applications/:id/status` | Update application status          |
| GET    | `/api/dashboard`               | Dashboard stats + recent activity  |
| GET    | `/api/cover-letters`           | List cover letters                 |

This is a representative subset. The Worker also mounts routes for resumes, resume
variants, projects, personal info, interview preps, reports, dialogue capture, the content
catalog, and onboarding. See the full request/response schemas in
[API Contracts](../../docs/architecture/API_CONTRACTS.md).

## Status Transitions

```
saved → applied → phone_screen → interview → offer (terminal)
                              ↘                  ↘ rejected (terminal)
                               → rejected          ↘
                ↘ rejected                          withdrawn (terminal)
                ↘ withdrawn
```

Transitions are validated server-side by `VALID_TRANSITIONS` in
`src/services/status.service.ts`, applied inside a DB transaction. Terminal statuses:
`offer`, `rejected`, `withdrawn`.

## Environment & Secrets

At the edge the Worker uses **Cloudflare bindings** (declared in the repo-root
`wrangler.jsonc`, typed in `src/types/env.ts`), not `process.env`. Because Workers are
stateless, the DB client and env are created per request (`runWithEnv` in
`src/db/context.ts`) rather than as a global singleton.

Local dev secrets go in `.dev.vars` (copy from `.dev.vars.example`). Production secrets are
set with `wrangler secret put`.

| Variable              | Required | Description                                                                                                       |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`        | For auth | Supabase project URL                                                                                              |
| `SUPABASE_ANON_KEY`   | For auth | Supabase anon key                                                                                                 |
| `SUPABASE_JWT_SECRET` | For auth | JWT secret. When set (with `SUPABASE_URL`), `/api/*` requires a valid JWT; when both are unset, auth is bypassed. |
| `ANTHROPIC_API_KEY`   | For AI   | Anthropic Claude key (resume parsing, job-fit, dialogue). AI features disabled when unset.                        |
| `NODE_ENV`            | No       | `production` in prod (set in `wrangler.jsonc`).                                                                   |

Bindings (not env vars):

| Binding      | Purpose                                                      |
| ------------ | ------------------------------------------------------------ |
| `HYPERDRIVE` | Pooled connection to Supabase Postgres (`.connectionString`) |
| `R2_BUCKET`  | Document storage bucket (`jobtrail-documents`)               |

> `DATABASE_URL` is **not** used by the Worker — the `HYPERDRIVE` binding handles Postgres.
> It is only read by the migration runner (`src/db/migrate.ts`); point it at the Supabase
> transaction-pooler URL.

## Running Tests

```bash
# Unit + route tests (Vitest, no DB required)
npm test

# Watch mode
npm run test:watch

# Coverage (V8)
npm run test:coverage
```

## Database Migrations

Drizzle ORM + drizzle-kit. The migration runner reads `DATABASE_URL`.

```bash
# Generate a new migration from schema changes
npm run db:generate

# Apply pending migrations (reads DATABASE_URL)
npm run db:migrate

# Push schema directly (dev only)
npm run db:push
```

## Project Structure

```
packages/api/
├── src/
│   ├── worker.ts           # Cloudflare Worker entry (fetch handler, Hyperdrive retry)
│   ├── index.ts            # Node.js entry (@hono/node-server) for local dev
│   ├── app.ts              # Hono app builder (CORS, routes, error handler)
│   ├── config.ts           # Environment config
│   ├── db/
│   │   ├── context.ts      # Per-request env/db context (runWithEnv)
│   │   ├── client.ts       # Drizzle connection
│   │   ├── hyperdrive.ts   # Hyperdrive connection + timeout detection
│   │   ├── schema.ts       # Drizzle schema
│   │   └── migrate.ts      # Migration runner (reads DATABASE_URL)
│   ├── middleware/
│   │   └── auth.ts         # Hono JWT auth middleware (jose)
│   ├── routes/             # applications, auth, dashboard, cover-letters, resumes,
│   │                       # resume-variants, projects, personal-info, interview-preps,
│   │                       # reports, dialogue, catalog, onboarding
│   ├── services/           # Business logic (accept env/db per request)
│   └── types/
│       ├── env.ts          # Env interface (bindings) + Hono variables
│       └── index.ts        # DTOs, error classes (AppError, NotFoundError, …)
├── test/
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```
