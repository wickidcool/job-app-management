# Job Application Manager

A multi-user web application for tracking job applications, resumes, and interview prep. Built with React and TypeScript, and deployed to production at **[careerpin.app](https://careerpin.app)** on Cloudflare Workers.

## Architecture

The app runs as a **single Cloudflare Worker** (Hono) that serves both the API and the built React SPA:

```
                    ┌──────────────────────────────────────┐
   Browser ───────▶ │        Cloudflare Worker (Hono)       │
   careerpin.app    │                                       │
                    │  /api/*, /health  → Hono API routes   │
                    │  everything else  → React SPA assets  │
                    │                     (packages/web/dist)│
                    └───────┬───────────────────────┬───────┘
                            │                       │
                  Hyperdrive (pooling)        R2 binding
                            │                       │
                            ▼                       ▼
                 ┌────────────────────┐   ┌────────────────────┐
                 │ Supabase Postgres  │   │  Cloudflare R2      │
                 │ (transaction pool) │   │  jobtrail-documents │
                 └────────────────────┘   └────────────────────┘
```

- **Backend** — [Hono](https://hono.dev) on Cloudflare Workers. Runtime bindings (`HYPERDRIVE`, `R2_BUCKET`) replace `process.env` at the edge; the same code also runs on Node.js via `@hono/node-server` for local iteration. See [ADR-006](docs/architecture/adr/ADR-006-hono-framework-workers.md).
- **Database** — Supabase PostgreSQL, reached from the Worker through a [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/) connection pool. Drizzle ORM over the `postgres` driver.
- **Storage** — Resume and cover-letter files live in **Cloudflare R2** (`jobtrail-documents`), keyed by `{userId}/{type}/{filename}`. Presigned download URLs are generated with the AWS S3 SDK. See [ADR-004](docs/architecture/adr/ADR-004-cloudflare-r2-storage.md).
- **Auth** — Supabase Auth (multi-user). When `SUPABASE_JWT_SECRET` is set, every `/api/*` route requires a valid JWT (verified with `jose`); with it unset, auth is bypassed for single-user local dev. See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).
- **AI** — Anthropic Claude (`@anthropic-ai/sdk`) powers resume parsing, job-fit analysis, and dialogue capture. PDF/DOCX text extraction uses `pdfjs-dist`, `mammoth`, and `docx`.

Full detail: [docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md](docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md).

## Project Structure

npm-workspaces monorepo:

```
packages/
├── web/          # Vite/React 19 frontend SPA (@wic/web)
├── api/          # Hono backend — Cloudflare Workers + Node (@wic/api)
├── marketing/    # Static marketing site (careerpin.app landing/pricing)
└── infra/        # Redirect Worker / Pages config
wrangler.jsonc    # Worker config: assets, R2, Hyperdrive, preview env
supabase/         # Supabase project config
```

### Frontend (`@wic/web`)

- **Framework:** React 19 + React Router 7
- **Build Tool:** Vite
- **Styling:** Tailwind CSS 3, Radix UI, `@dnd-kit`
- **Data:** TanStack Query 5
- **Forms:** React Hook Form + Zod

### Backend (`@wic/api`)

- **Framework:** Hono 4 (Cloudflare Workers; Node via `@hono/node-server`)
- **ORM:** Drizzle (PostgreSQL / Supabase via Hyperdrive)
- **Storage:** Cloudflare R2 (S3-compatible)
- **Auth:** Supabase JWT verification (`jose`)
- **Analytics:** Provider-agnostic event wrapper (`noop` / `console` / `posthog`); **live in production** — the prod Worker and SPA build run `ANALYTICS_SINK=posthog`, capturing the 9 resume/export events to PostHog (as of 2026-08-11)
- **Language:** TypeScript

## Getting Started

### Prerequisites

- Node.js v20+
- npm v7+ (workspaces support)
- A Supabase project (or the Supabase CLI for a local stack) — for auth and Postgres
- `wrangler` (bundled via `npx`) to run the Worker locally

### Installation

```bash
npm install
```

### Configure secrets

Copy the example dev secrets and fill in your Supabase / Anthropic values:

```bash
cp .dev.vars.example .dev.vars
```

`wrangler dev` reads `.dev.vars` automatically. Binding names match `packages/api/src/types/env.ts`. `DATABASE_URL` is **not** used by the Worker (Hyperdrive handles Postgres); it is only used by the migration runner.

### Run locally

There are two backend dev modes:

```bash
# Frontend dev server (http://localhost:5173)
npm run dev

# Option A — run the API as a Worker under wrangler/miniflare (R2 + Hyperdrive emulation)
npm run dev:worker

# Option B — run the API on Node.js for faster iteration (http://localhost:3000)
npm run dev:api
```

Apply database migrations against your configured `DATABASE_URL` (use the Supabase transaction-pooler URL for a cloud DB):

```bash
npm run db:migrate
```

## Available Scripts

| Command                           | Description                                           |
| --------------------------------- | ----------------------------------------------------- |
| `npm run dev`                     | Start the frontend dev server (Vite, port 5173)       |
| `npm run dev:api`                 | Run the API on Node.js via `tsx` (port 3000)          |
| `npm run dev:worker`              | Run the API as a Cloudflare Worker via `wrangler dev` |
| `npm run build`                   | Build all packages                                    |
| `npm run build:web` / `build:api` | Build a single package                                |
| `npm run typecheck`               | Type-check web + api (`tsc -b --noEmit`)              |
| `npm run lint`                    | Lint all packages                                     |
| `npm run test`                    | Run unit tests (Vitest) across packages               |
| `npm run test:e2e`                | Run Playwright E2E tests                              |
| `npm run format`                  | Format with Prettier                                  |
| `npm run db:migrate`              | Run database migrations                               |
| `npm run db:push`                 | Push schema changes directly (dev only)               |

Run a script in one package: `npm run <script> --workspace=@wic/web` (or `@wic/api`).

## Deployment

Production deploys are automated with **GitHub Actions** (`.github/workflows/deploy.yml`):

- **Pull requests** → lint, typecheck, test, build, and a **preview** Worker deploy (`jobtrail-preview`).
- **Merge to `main`** → runs database migrations over the Supabase transaction pooler, validates secrets, and deploys the production Worker with `wrangler deploy`.

Production secrets are set with `wrangler secret put`; non-secret vars live in `wrangler.jsonc`. See [docs/architecture/CI_CD.md](docs/architecture/CI_CD.md) and [docs/architecture/CLOUD_ENV_SECRETS.md](docs/architecture/CLOUD_ENV_SECRETS.md).

## Documentation

- [Cloudflare Workers Architecture](docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md)
- [Authentication (Supabase)](docs/AUTHENTICATION.md)
- [API Contracts](docs/architecture/API_CONTRACTS.md) · [Data Model](docs/architecture/DATA_MODEL.md)
- [Analytics — Event Taxonomy & KPIs](docs/analytics/metrics-baseline.md) · [Dashboard Spec](docs/analytics/dashboard-spec.md)
- [Self-Hosting](docs/SELF_HOST.md)
- ADRs: [ADR-0001 (fleet secrets standard)](docs/architecture/adr/ADR-0001-fleet-secrets-credential-management.md) · [ADR-004 (R2 storage)](docs/architecture/adr/ADR-004-cloudflare-r2-storage.md) · [ADR-006 (Hono)](docs/architecture/adr/ADR-006-hono-framework-workers.md) · [ADR-003 (multi-user auth)](docs/architecture/adr/ADR-003-multi-user-auth.md) · [ADR-008 (score/rate units)](docs/architecture/adr/ADR-008-score-and-rate-unit-convention.md)

## Development Guidelines

- Follow TypeScript best practices; functional components with hooks
- Keep components small and focused; descriptive names
- Formatting/linting are enforced (`npm run format`, `npm run lint`)

## License

Proprietary — All rights reserved
