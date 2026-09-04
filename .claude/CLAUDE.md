# Careerpin

Multi-user job application tracking app running on **Cloudflare Workers + Supabase + R2**, deployed to production at [careerpin.app](https://careerpin.app). A single Hono Worker serves the `/api/*` routes and the built React SPA; the same code also runs on Node.js for local dev.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 3, TanStack Query 5, React Router 7, React Hook Form, Radix UI, @dnd-kit
- **Backend**: Hono 4 on Cloudflare Workers (Node.js fallback via `@hono/node-server`), TypeScript, Drizzle ORM
- **Database**: Supabase PostgreSQL via Drizzle ORM + postgres-js; migrations via drizzle-kit. Preview reaches it through a Cloudflare Hyperdrive pool; **production has no Hyperdrive binding** and connects to the Supabase transaction pooler (port 6543) via a `DATABASE_URL` secret
- **Storage**: Cloudflare R2 (`jobtrail-documents`) for resumes/cover letters, S3-compatible presigned URLs via the AWS SDK
- **Auth**: Supabase Auth (multi-user); JWTs verified server-side with `jose`
- **AI**: Anthropic Claude (`@anthropic-ai/sdk`); PDF/DOCX extraction via `pdfjs-dist`, `mammoth`, `docx`
- **Testing**: Vitest (backend unit), Playwright (E2E)
- **Tooling**: npm workspaces monorepo, Prettier, ESLint, Wrangler

## Monorepo Layout

```
packages/
  api/          @wic/api  — Hono backend (Workers + Node)
    src/
      worker.ts           Cloudflare Worker entry (fetch handler, Hyperdrive retry)
      index.ts            Node.js entry (@hono/node-server) for local dev
      app.ts              Hono app builder (CORS, error handler, route mounting)
      config.ts           Environment config
      db/
        context.ts        Per-request env/db context (runWithEnv)
        client.ts         Drizzle connection
        hyperdrive.ts     Hyperdrive connection + timeout detection
        schema.ts         Drizzle ORM table definitions
        migrate.ts        Migration runner (reads DATABASE_URL)
      middleware/
        auth.ts           Hono JWT auth middleware (jose)
      routes/             applications, auth, catalog, cover-letters, dashboard,
                          dialogue, interview-preps, onboarding, personal-info,
                          projects, reports, resume-variants, resumes
      services/           Business logic (accept env/db per request — Workers are stateless)
      types/
        env.ts            Env interface (bindings) + Hono variables
        index.ts          DTOs, error classes (AppError, NotFoundError, etc.)

  web/          @wic/web  — React SPA (Vite dev server port 5173)
    src/
      main.tsx            Entry point
      App.tsx             Root component, React Router setup
      components/         UI components (ApplicationCard, KanbanBoard, ResumeUpload, etc.)
      pages/              Route pages (Dashboard, ApplicationsList, ApplicationDetail, etc.)
      hooks/              TanStack Query hooks
      services/api/       HTTP client layer (Authorization: Bearer token)
      types/              Frontend type definitions

  marketing/    Static marketing site (careerpin.app landing/pricing)
  infra/        Redirect Worker / Pages config

wrangler.jsonc            Worker config: assets (SPA), R2, vars; Hyperdrive under env.preview only
docs/
  architecture/           ARCHITECTURE.md (current-state overview — start here),
                          CLOUDFLARE_WORKERS_ARCHITECTURE.md (migration record, historical),
                          API_CONTRACTS.md, DATA_MODEL.md, CI_CD.md, ADRs
  AUTHENTICATION.md       Supabase auth
  design/                 DESIGN_SYSTEM.md, COMPONENT_SPECS.md, USER_FLOWS.md, WIREFRAMES.md
```

## Runtime & Bindings

The Worker prefers **Cloudflare bindings** over `process.env`. Because Workers are stateless, the database client and env are created per-request (`runWithEnv` in `db/context.ts`) rather than as a global singleton. Bindings are declared in `wrangler.jsonc` and typed in `src/types/env.ts`:

| Binding | Purpose |
|---|---|
| `ASSETS` | Built React SPA (`packages/web/dist`), `not_found_handling: "single-page-application"` |
| `HYPERDRIVE` | Pooled connection to Supabase Postgres (`.connectionString`). **Declared under `env.preview` only** — production has no Hyperdrive binding and uses the `DATABASE_URL` secret instead |
| `R2_BUCKET` | Document storage bucket (`jobtrail-documents` in production, `jobtrail-documents-dev` in preview) |

`db/client.ts` resolves in order: `HYPERDRIVE` → `DATABASE_URL` → Node singleton. Preview takes path 1; **production and bare `wrangler dev` take path 2** (`npm run dev:worker` passes no `--env`, so it loads the top-level config, which declares no Hyperdrive).

## Key Commands

```bash
npm install                   # Install all workspace deps
npm run dev                   # Frontend dev server (localhost:5173)
npm run dev:worker            # API as a Worker via wrangler dev (top-level config: assets + R2, no Hyperdrive)
npm run dev:api               # API on Node.js via tsx (localhost:3000) — faster iteration
npm run build                 # Build all packages
npm run typecheck             # tsc -b web + api --noEmit
npm run lint                  # Lint all packages
npm run test                  # Vitest unit tests
npm run test:e2e              # Playwright E2E tests
npm run format                # Prettier format
npm run db:migrate            # Run database migrations (reads DATABASE_URL)
npm run db:push               # Push schema changes directly (dev only)
```

## Architecture Decisions

- **Edge-native, stateless**: DB client + env are per-request; no global singletons (`runWithEnv`)
- **Hono over Fastify** for Workers compatibility (`ADR-006-hono-framework-workers`)
- **Hyperdrive** pools the Supabase Postgres connection at the edge **in `preview` only**; production falls back to a `DATABASE_URL` pointed at the Supabase transaction pooler. The fetch handler retries up to 3 times on Hyperdrive connection timeouts, then returns `503`
- **R2 storage** for documents, keyed `{userId}/{type}/{filename}`; presigned URLs via AWS SDK (`ADR-004-cloudflare-r2-storage`)
- **Multi-user auth**: all `/api/*` routes require a valid Supabase JWT as `Authorization: Bearer` (`userId` from the `sub` claim). Auth is bypassed only when **both** `SUPABASE_URL` **and** `SUPABASE_JWT_SECRET` are absent (`ADR-003-multi-user-auth`)
- **ES modules** throughout (`"type": "module"`)
- **ULIDs** for primary keys (via `ulid`)
- **Optimistic locking** — mutable records have a `version` column; updates require the current version
- **Status transitions** validated server-side via `VALID_TRANSITIONS` in `status.service.ts`, using DB transactions
- **Cursor-based pagination** (base64url-encoded offset) on list endpoints
- **Zod** for request validation on all API routes
- The single Worker serves the SPA: `wrangler.jsonc` `assets` binding with `not_found_handling: "single-page-application"` for React Router deep links

## Database

Supabase PostgreSQL with Drizzle ORM. Core tables:

| Table | Purpose |
|---|---|
| `applications` | Job applications (status, company, job title, per-user) |
| `status_history` | Audit trail of status changes per application |
| `resumes` / `resume_variants` / `resume_exports` | Uploaded resumes, tailored variants, generated exports |
| `cover_letters` / `outreach_messages` | Cover letters and outreach drafts |
| `personal_info` / `quantified_bullets` | Candidate profile + reusable achievement bullets |
| `interview_preps` / `interview_prep_stories` / `prep_question_story_links` | Interview prep, STAR stories, question links |
| `catalog_diffs` / `catalog_change_log` / `wikilink_registry` | Content catalog change tracking + wikilinks |
| `onboarding_status` | Per-user onboarding progress |

Status enum: `saved → applied → phone_screen → interview → offer | rejected | withdrawn`
(most non-terminal states may also go directly to `rejected`/`withdrawn`). Terminal statuses: `offer`, `rejected`, `withdrawn`.

## Naming Conventions

- **Files**: camelCase for utilities/services, PascalCase for React components
- **Database columns**: snake_case
- **JS/TS properties**: camelCase
- **Constants**: UPPER_SNAKE_CASE

## Environment Variables

Local dev secrets: copy `.dev.vars.example` → `.dev.vars` (loaded by `wrangler dev`). Production: `wrangler secret put`. Binding/var names are typed in `packages/api/src/types/env.ts`.

Object bindings are only reachable off the request `env`; text vars and secrets are reachable both there **and** on `process.env` (`nodejs_compat` is enabled), which is what `config.ts` reads. Call sites usually do `c.env?.X ?? getConfig().x`.

| Variable | Scope | Description |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_JWT_SECRET` | Worker | Supabase auth. `/api/*` is unguarded only if `SUPABASE_URL` and `SUPABASE_JWT_SECRET` are **both** absent |
| `ANTHROPIC_API_KEY` | Worker | Claude API; AI features disabled when unset. `LLM_MODEL` overrides the model (default `claude-sonnet-4-6`) |
| `POSTHOG_API_KEY` | Production Worker | PostHog write key, pushed as a **secret** by `deploy.yml`; unset ⇒ analytics degrades to the noop sink with a warning |
| `ANALYTICS_SINK` / `POSTHOG_HOST` | Worker | Non-secret, set in `wrangler.jsonc` `vars` (`posthog` / `https://us.i.posthog.com`) |
| `NODE_ENV` | Worker | Set in `wrangler.jsonc` |
| `DATABASE_URL` | Production Worker + migrations | Supabase transaction-pooler URL (6543). Pushed as a production Worker secret by `deploy.yml` and read by `db:migrate`. Preview uses the `HYPERDRIVE` binding instead |
| `VITE_API_BASE_URL` | Web build | API base; defaults to `/api` (same-origin) |

## Design System

Tailwind config defines custom tokens:
- **Colors**: primary (blue), neutral (gray), success/warning/error/info + per-status colors (`status.saved`, `status.applied`, etc.)
- **Typography**: display, h1–h4, body-lg/body/body-sm, caption, overline
- **Transitions**: fast (150ms), base (250ms), slow (350ms)

## Testing

- Backend: `vitest` with V8 coverage. Tests in `packages/api/test/`.
- E2E: Playwright (`npm run test:e2e`), configured in `playwright.config.ts`.
