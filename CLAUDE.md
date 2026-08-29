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

npm run build              # Build all packages — this is the type check CI enforces
npm run typecheck          # tsc -b web + api --noEmit — a different, weaker check (see below)
npm run lint               # Lint all packages
npm run test               # Unit tests (Vitest)
npm run test:e2e           # Playwright E2E tests

npm run db:migrate         # Run migrations (reads DATABASE_URL)
npm run db:push            # Push schema directly (dev only)
```

### `npm run typecheck` is not the check CI runs

`npm run typecheck` and `npm run build` disagree, and neither is a superset of the other. Measured on `7a9ee29` — the exact commit CI rejected — with both build caches cleared first: `npm run typecheck` exits **0**, `npm run build` exits **2**. So reproduce CI with the build:

```bash
rm -rf packages/*/node_modules/.tmp   # the tsbuildinfo files; CI never has one
npm run build                         # what `Lint & Test` → "Build packages" runs
```

There are two independent reasons they diverge.

**They run different compilers.** `typescript` is pinned twice in `package-lock.json`: `node_modules/typescript` is **5.9.3**, and `packages/web/node_modules/typescript` is **6.0.3**. A root script resolves the root binary, while `packages/web`'s own `build` (`tsc -b && vite build`) runs with cwd `packages/web` and resolves 6.0.3. `packages/web/tsconfig.app.json` declares no `strict`, and **TypeScript 6 defaults `strict` on where 5.9 defaults it off** — so this package's strictness is decided by which binary you invoke, not by its tsconfig. Verified on an empty project: `export function f(x) { return x; }` is clean under 5.9.3 and `TS7006` under 6.0.3. This is also why `npx tsc -b packages/web packages/api --force` from the repo root is **not** a CI reproduction, `--force` notwithstanding — it exits 0 on the tree CI rejected. From inside the package, `npx tsc -b --force`, it exits 2.

**Both are incremental, and CI is always cold.** `packages/web/tsconfig.app.json:3` and `tsconfig.node.json:3` put `tsBuildInfoFile` under `./node_modules/.tmp/`, which `.gitignore:44` ignores and `npm ci` never restores. Your machine always builds warm; CI always builds cold. The risk is highest right after adding a new source file — the state a stale buildinfo has never seen.

### Only import direct dependencies

A package that is merely a transitive dependency can resolve at runtime and still be invisible to `tsc`. The hoisted `dom-accessibility-api@0.5.16` (present via `@testing-library`) declares an `exports` block with `import` and `require` conditions and **no `types` condition**, so under `moduleResolution: bundler` TypeScript resolves the import to `dist/index.mjs` — the JavaScript — and reports `TS7016: Could not find a declaration file`, even though `dist/index.d.ts` is sitting beside it. That is the error that failed PR #224's first push, and it is invisible to `npm run typecheck`: under the root's non-strict 5.9.3 the same import silently becomes `any`, so the weaker check does not merely miss the error, it accepts unchecked code.

For accessible-name assertions use jest-dom's `toHaveAccessibleName`, which is declared and registered for every test file by `packages/web/src/test/setup.ts`. The helpers in `packages/web/src/test/prohibitedName.ts` carry the same instruction at the call site.

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
trusted and wrong in ways nothing reports. Three failure modes have reached `main` or an open PR:

- **Both sides revised the same existing entry.** Union keeps both revisions, so the file ships two
  contradictory descriptions of one change, with no conflict ever shown (WIC-1561, fixed by #181).
  The kept copy can be the **superseded** one: in WIC-1597 a merged code-review correction was
  silently republished alongside the claim it retracted.
- **Union ate the blank line between two entries.** Inserting a new entry directly above an existing
  one can consume the separator at the seam, leaving a `### ` heading welded to the previous entry's
  last bullet — even though *both* parents had the blank line (WIC-1567, fixed by #185).
- **One side moved a block, the other edited inside it.** The two do not line up as one diff3 region,
  so union keeps the relocated copy *and* the edited copy — a whole `### ` entry, duplicated. Note
  what this means: **moving a block is the documented fix for the ordering defect, so the remedy for
  one failure mode arms another** for the next branch that touches that entry (WIC-1692, caught on
  PR #212 before merge).

So after any merge that touches `CHANGELOG.md`, run the checks the driver cannot:

```bash
python3 - CHANGELOG.md <<'PY'
import re, sys, collections
L = open(sys.argv[1]).read().split('\n')
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()
bul, head = collections.defaultdict(list), collections.defaultdict(list)
for n, l in enumerate(L, 1):
    s = l.strip()
    if s.startswith('- ') and len(s) > 60: bul[norm(s)[:70]].append(n)
    if s.startswith('### '):               head[norm(s)[:55]].append(n)
sep = [n + 1 for n, l in enumerate(L) if l.startswith('### ') and n and L[n - 1].strip()]
print('duplicate headings:', {k: v for k, v in head.items() if len(v) > 1} or 'none')
print('duplicate bullets:', {k: v for k, v in bul.items() if len(v) > 1} or 'none')
print('headings missing a preceding blank line (line nos):', sep or 'none')
PY
```

It compares a **normalised prefix**, not the whole line, because the duplicates that matter are
usually *reworded* — an earlier `Counter` over byte-identical lines could not see the WIC-1561 class
it was written for (WIC-1687). The tradeoff is deliberate: a prefix match will also flag genuine
pairs that merely open the same way, so **read both lines in full before acting — the discriminator
is the tail, not the prefix.** Two known-benign pairs live on `main` today (the boilerplate
"Documentation only. No code, no tests…" opener, and the paired RLS "App runtime is unaffected…"
bullets); anything else is a real double-ship until you have shown otherwise. **A duplicate `### `
heading has no benign case** — that one is always a bug.

Resolution is **per bullet**. Never take-ours or take-theirs wholesale: each side usually holds an
entry the other genuinely lacks, which is the whole reason the driver is there. The exception is a
clean strict superset — if one copy is the other plus additions, delete the shorter copy whole, then
re-check the seam you left behind.

**Run this on the branch, not only after your own merge.** A clean `main` says nothing about what is
queued to land on it, and the corruption exists only in the merge *result* — both parents can be
individually spotless. To see it before you push, simulate what the driver will do, and simulate it
against **the PR's true base** (`gh pr view N --json baseRefName`), never `main`: many PRs here are
stacked, and simulating a stacked PR against `main` manufactures duplicates that will never ship.

```bash
n=212; BASE=$(gh pr view $n --json baseRefName -q .baseRefName)
git fetch origin "+refs/pull/$n/head:refs/remotes/pr/$n"
MB=$(git merge-base "origin/$BASE" "refs/remotes/pr/$n")
git show "origin/$BASE":CHANGELOG.md   > ours.md
git show "$MB":CHANGELOG.md            > base.md
git show "refs/remotes/pr/$n":CHANGELOG.md > theirs.md
git merge-file -p --union ours.md base.md theirs.md > union.md   # then run the checks above
```

Use `--union` here deliberately: the question is what the driver *will do*, which is the opposite of
the `merge-file`-without-driver check under "Diagnosing one" (that one asks whether GitHub sees a
conflict). Don't confuse the two.

**Counts in changelog prose rot.** An entry saying "all six `cursor` rows" was correct when written
and stale the same day, because another PR documented four more endpoints. Cite the rule the file
states, not a tally you took by grep (WIC-1567).
