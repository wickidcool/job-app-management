# Job App Management — Developer Reference

Multi-user job application tracker. Runs as a **single Cloudflare Worker (Hono)** that serves both the `/api/*` routes and the built React SPA, backed by **Supabase Postgres** and **Cloudflare R2**. Deployed to production at [careerpin.app](https://careerpin.app).

See `docs/architecture/ARCHITECTURE.md` for the current-state overview. (`docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md` is the *migration* record — how the Fastify→Hono move was planned, not what runs today.)

## Project Structure

```
packages/
  api/        @wic/api  — Hono backend (Cloudflare Workers + Node fallback, TypeScript)
  web/        @wic/web  — React 19 SPA (Vite, Tailwind)
  marketing/  — Static marketing site
  infra/      — Redirect Worker / Pages config
wrangler.jsonc — Worker config (assets, R2, vars; Hyperdrive under `env.preview` only)
supabase/      — Supabase project config
```

Worker entry point: `packages/api/src/worker.ts`. The same Hono app (`src/app.ts`) also runs on Node.js via `src/index.ts` (`@hono/node-server`) for local dev.

## Runtime & Bindings

At the edge the Worker's preferred source of truth is **Cloudflare bindings** rather than `process.env`. Binding names are defined in `wrangler.jsonc` and typed in `packages/api/src/types/env.ts`:

| Binding | Type | Purpose |
|---|---|---|
| `ASSETS` | Fetcher | Built React SPA (`packages/web/dist`), with `not_found_handling: "single-page-application"` |
| `HYPERDRIVE` | Hyperdrive | Pooled connection to Supabase Postgres (`.connectionString`). **Declared under `env.preview` only** — production has no Hyperdrive binding. |
| `R2_BUCKET` | R2Bucket | Document storage (`jobtrail-documents` in production, `jobtrail-documents-dev` in preview) |

`packages/api/src/db/client.ts` picks a connection in this order: `HYPERDRIVE` binding → `DATABASE_URL` → Node singleton. Because the root `wrangler.jsonc` declares Hyperdrive only for `preview`, **preview takes path 1 and production takes path 2**, connecting to the Supabase transaction pooler on port 6543.

`npm run dev:worker` is a bare `wrangler dev` with no `--env`, so it loads the *top-level* config — it gets `ASSETS` and `R2_BUCKET` but **no `HYPERDRIVE` binding**, and therefore also takes path 2, reading `DATABASE_URL` from `.dev.vars`.

## Environment Variables & Secrets

Local dev secrets go in `.dev.vars` (copy from `.dev.vars.example`); `wrangler dev` loads them automatically. Production secrets are set with `wrangler secret put`. Non-secret vars (`NODE_ENV`, `ANALYTICS_SINK`, `POSTHOG_HOST`) live in `wrangler.jsonc` `vars`.

Two read paths coexist, so don't assume either one alone. Object bindings (`ASSETS`, `HYPERDRIVE`, `R2_BUCKET`) are only ever reachable off the request `env`. Text vars and secrets are reachable **both** ways — `nodejs_compat` is enabled, so the runtime also exposes them on `process.env`, which is what `config.ts` reads. Call sites generally prefer the binding and fall back to config, e.g. `middleware/auth.ts`: `c.env?.SUPABASE_URL ?? getConfig().supabaseUrl`.

### Worker (API)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | For auth | Supabase project URL. Also gates the auth bypass — see below. |
| `SUPABASE_ANON_KEY` | For auth | Supabase anon key |
| `SUPABASE_JWT_SECRET` | For auth | JWT secret (HS256 path). Auth is bypassed only when **both** this **and** `SUPABASE_URL` are absent (`middleware/auth.ts`) — setting just one leaves `/api/*` requiring a valid JWT. |
| `DATABASE_URL` | Production | Supabase transaction-pooler URL (port 6543), pushed as a Worker secret by `deploy.yml`. Unused in `preview`, which has the `HYPERDRIVE` binding instead. |
| `ANTHROPIC_API_KEY` | For AI | Anthropic Claude key for resume parsing, job-fit analysis, dialogue capture. AI features are disabled when unset. |
| `LLM_MODEL` | No | Model id for the AI features. Defaults to `claude-sonnet-4-6` (`config.ts`). |
| `POSTHOG_API_KEY` | For analytics | PostHog write key, pushed as a production Worker **secret** by `deploy.yml`. Unset ⇒ the analytics sink degrades to noop with a warning. |
| `ANALYTICS_SINK` | No | `posthog` in prod (set in `wrangler.jsonc` `vars`). |
| `POSTHOG_HOST` | No | `https://us.i.posthog.com` (set in `wrangler.jsonc` `vars`; same value is the `config.ts` default). |
| `NODE_ENV` | No | `production` in prod (set in `wrangler.jsonc`). |
| `TRUST_PROXY_PROTO` | No | Opt in to trusting `x-forwarded-proto` for the HTTPS redirect. |

> `DATABASE_URL` **is** used by the production Worker. `deploy.yml` builds the Supabase transaction-pooler URL (port 6543) and pushes it as a Worker secret, and `db/client.ts` falls back to it because production declares no `HYPERDRIVE` binding. It is also what the migration runner (`packages/api/src/db/migrate.ts`) reads. `R2_BUCKET` is a native binding, not an env var.

### Frontend (`@wic/web`, Vite build-time)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | API base URL. Defaults to `/api` (same-origin — the Worker serves both the SPA and the API). |

## Common Commands

```bash
npm install                # Install all workspace deps

npm run dev                # Frontend dev server (Vite, :5173)
npm run dev:worker         # API as a Worker via `wrangler dev` (top-level config: assets + R2, no Hyperdrive)
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

## Changelog conventions

Every change gets an entry under `## [Unreleased]` in `CHANGELOG.md`.

**Add your entry _below_ the current top `### ` entry, not above it.** Entries inside a release are same-day and effectively unordered, so being first buys nothing — and being first is what causes conflicts.

`.gitattributes` marks `CHANGELOG.md merge=union`. That auto-resolves the merge **locally**, and only locally: GitHub computes mergeability without the driver, so a changelog the driver "fixed" for you still reports `CONFLICTING / DIRTY` on the PR page and still blocks the merge button. The driver hides the conflict from you and not from GitHub, which is why these show up late.

Every one of those conflicts is the same conflict: an insertion collision on the **first `### ` heading under the `[Unreleased]` backfill note**. The merge base at that point is *empty* and both sides are pure additions, which is why the resolution is always "keep both" and why it always comes back. That anchor is also **branch-point independent** — the backfill note has sat directly above it since `1ea6186` (2026-08-04), so every open PR resolves "the top of `[Unreleased]`" to the same line no matter when it was cut. A guaranteed collision, by construction.

Anchoring below the top entry breaks that. "Below the current top entry" resolves to a *different* line depending on which `main` you branched from, so only PRs cut from the identical commit can still collide. Measured on PR #174: it edited `CHANGELOG.md` while #111, #165 and #166 were open and added **zero** new conflicts to any of them, where #169, #170 and #172 each took the top anchor and #170 alone broke both #165 and #166.

### Diagnosing one

`git merge`, `git merge-tree` and a local `git pull` all apply the union driver, so they report **clean** on a PR GitHub calls `CONFLICTING`. They are not wrong; they are answering a different question. `git merge-file` is the low-level three-way merge and does not read `.gitattributes`, so it is the one that reproduces what GitHub sees:

```bash
BR=origin/your-branch
D=$(mktemp -d)
B=$(git merge-base origin/main $BR)
git show "$B":CHANGELOG.md        > "$D/base.md"
git show origin/main:CHANGELOG.md > "$D/main.md"
git show "$BR":CHANGELOG.md       > "$D/head.md"

git merge-file -p --diff3 "$D/head.md" "$D/base.md" "$D/main.md"   # non-zero exit = real conflict
git merge-file -p          "$D/main.md" "$D/base.md" "$D/main.md"  # positive control: MUST exit 0
```

Always run the control. Without it, a wrong path or a stale `origin` yields a silent "clean" that you will believe.

**Resolving:** keep both sides, and **merge `main` in — never rebase.** Many open PRs here are stacked (a PR whose base is another PR's branch), and rebasing a stack parent invalidates every child.

### Check what the driver did — "clean" is not "correct"

When you merge `main` in, the union driver resolves `CHANGELOG.md` for you and reports success. It
is resolving by concatenating both sides at each differing hunk, which is right often enough to be
trusted and wrong in ways nothing reports. Two failure modes have reached `main`:

- **Both sides revised the same existing entry.** Union keeps both revisions, so the file ships two
  contradictory descriptions of one change, with no conflict ever shown (WIC-1561, fixed by #181).
- **Union ate the blank line between two entries.** Inserting a new entry directly above an existing
  one can consume the separator at the seam, leaving a `### ` heading welded to the previous entry's
  last bullet — even though *both* parents had the blank line (WIC-1567, fixed by #185).

So after any merge that touches `CHANGELOG.md`, run the two checks the driver cannot:

```bash
python3 - CHANGELOG.md <<'PY'
import sys, collections
L = open(sys.argv[1]).read().split('\n')
dup = {k: v for k, v in collections.Counter(
    l.strip() for l in L if l.strip().startswith('- ') and len(l.strip()) > 40).items() if v > 1}
sep = [n + 1 for n, l in enumerate(L) if l.startswith('### ') and n and L[n - 1].strip()]
print('duplicate bullets:', dup or 'none')
print('headings missing a preceding blank line (line nos):', sep or 'none')
PY
```

Resolution is **per bullet**. Never take-ours or take-theirs wholesale: each side usually holds an
entry the other genuinely lacks, which is the whole reason the driver is there.

**Counts in changelog prose rot.** An entry saying "all six `cursor` rows" was correct when written
and stale the same day, because another PR documented four more endpoints. Cite the rule the file
states, not a tally you took by grep (WIC-1567).
