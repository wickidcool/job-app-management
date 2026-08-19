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

### Secrets-access documentation is prohibited (ADR-0001 Addendum A §1)

Do **not** author or commit any file whose purpose or effect is to describe how to
**obtain, decrypt, enumerate, or exfiltrate** live credentials or the systems that
store them — **even if it contains no literal secret value.** Specifically prohibited:

- paths to key material, keystores, or the secrets store, presented as access instructions;
- decryption/extraction code or commands targeting the secrets store;
- enumerations of stored secret _names_ together with their storage locations;
- connection strings, DB passwords, or key material.

Permitted: noting that a secrets system _exists_ and pointing at the owned tooling or
the access-request process. Prohibited: the extraction recipe. A document can contain
no secret value at all and still be a breach — that is the WIC-985 class, and it is
exactly what value-only scanners (gitleaks, GitHub secret scanning) pass clean.

Enforced at PR time by the `content-policy` workflow:

| Layer | Check | Catches |
|---|---|---|
| 1 | `gitleaks` (`.gitleaks.toml`) | literal secret **values** in the tree |
| 2 | `tools/secrets-access-lint/` | access **recipes** in added prose |

Run Layer 2 locally before committing:

```bash
npm run lint:content-policy              # diff vs origin/main
python3 tools/secrets-access-lint/secrets_access_lint.py --files path/to/doc.md
```

A false positive on legitimate security prose is waived only by an Architect/Librarian
approval recorded in the PR review — never by editing the pattern set to fit the file.

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
