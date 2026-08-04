# Job App Management — Developer Reference

Multi-user job application tracker. Runs as a **single Cloudflare Worker (Hono)** that serves both the `/api/*` routes and the built React SPA, backed by **Supabase Postgres** (via Hyperdrive) and **Cloudflare R2**. Deployed to production at [careerpin.app](https://careerpin.app).

See `docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md` for the full picture.

## Project Structure

```
packages/
  api/        @wic/api  — Hono backend (Cloudflare Workers + Node fallback, TypeScript)
  web/        @wic/web  — React 19 SPA (Vite, Tailwind)
  marketing/  — Static marketing site
  infra/      — Redirect Worker / Pages config
wrangler.jsonc — Worker config (assets, R2, Hyperdrive, preview env)
supabase/      — Supabase project config
```

Worker entry point: `packages/api/src/worker.ts`. The same Hono app (`src/app.ts`) also runs on Node.js via `src/index.ts` (`@hono/node-server`) for local dev.

## Runtime & Bindings

At the edge the Worker uses **Cloudflare bindings**, not `process.env`. Binding names are defined in `wrangler.jsonc` and typed in `packages/api/src/types/env.ts`:

| Binding | Type | Purpose |
|---|---|---|
| `HYPERDRIVE` | Hyperdrive | Pooled connection to Supabase Postgres (`.connectionString`) |
| `R2_BUCKET` | R2Bucket | Document storage (`jobtrail-documents`) |

## Environment Variables & Secrets

Local dev secrets go in `.dev.vars` (copy from `.dev.vars.example`); `wrangler dev` loads them automatically. Production secrets are set with `wrangler secret put`. Non-secret vars (`NODE_ENV`) live in `wrangler.jsonc`.

### Worker (API)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | For auth | Supabase project URL |
| `SUPABASE_ANON_KEY` | For auth | Supabase anon key |
| `SUPABASE_JWT_SECRET` | For auth | JWT secret. When set, all `/api/*` endpoints require a valid JWT; when unset, auth is bypassed (single-user/local). |
| `ANTHROPIC_API_KEY` | For AI | Anthropic Claude key for resume parsing, job-fit analysis, dialogue capture. AI features are disabled when unset. |
| `NODE_ENV` | No | `production` in prod (set in `wrangler.jsonc`). |

> `DATABASE_URL` is **not** used by the Worker — the `HYPERDRIVE` binding handles Postgres. It is only read by the migration runner (`packages/api/src/db/migrate.ts`); use the Supabase transaction-pooler URL there. `R2_BUCKET` is a native binding, not an env var.

### Frontend (`@wic/web`, Vite build-time)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | API base URL. Defaults to `/api` (same-origin — the Worker serves both the SPA and the API). |

## Common Commands

```bash
npm install                # Install all workspace deps

npm run dev                # Frontend dev server (Vite, :5173)
npm run dev:worker         # API as a Worker via `wrangler dev` (R2/Hyperdrive emulation)
npm run dev:api            # API on Node.js via tsx (:3000) — faster iteration

npm run build              # Build all packages
npm run typecheck          # tsc -b web + api --noEmit
npm run lint               # Lint all packages
npm run test               # Unit tests (Vitest)
npm run test:e2e           # Playwright E2E tests

npm run db:migrate         # Run migrations (reads DATABASE_URL)
npm run db:push            # Push schema directly (dev only)
```

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`): PRs get a preview Worker deploy; merges to `main` run DB migrations over the Supabase pooler, validate secrets, and `wrangler deploy` to production. See `docs/architecture/CI_CD.md`.
