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

npm run build              # Build all packages — the type check that actually gates a PR
npm run typecheck          # tsc -b web + api --noEmit — same compiler as the build (see below)
npm run lint               # Lint all packages
npm run test               # Unit tests (Vitest)
npm run test:e2e           # Playwright E2E tests

npm run db:migrate         # Run migrations (reads DATABASE_URL)
npm run db:push            # Push schema directly (dev only)

npm run preflight          # Refuse to certify a suite result from a stale/dirty checkout — run BEFORE quoting one
```

### Run `npm run preflight` before you quote a suite result

A checkout behind `origin/main` runs the stale *tests* against the stale *code*. They agree, so the
tree reads green — and that green carries **no information** about whether a shipped fix is armed
there. A suite cannot detect this about itself: every file is stale together, including the
assertions that would have caught it. Measured twice on 2026-09-07, in two independent trees on the
same day — the primary checkout 3 commits behind (so `scripts/vitest-version-guard.mjs` was still
fail-opening on semver prereleases, and `4.2.0-beta.1` satisfied `^4.1.11`), and a second workspace
checkout 16 behind with the same fix absent.

```bash
npm run preflight                 # exit 0 = safe to quote; non-zero = do not
npm run preflight -- --allow-dirty   # certify the commit graph alone, ignoring uncommitted work
```

It **asserts, and never syncs** — no reset, merge, or fast-forward, because a helper that resets to
the remote drops local commits. It names the missing commits and leaves the reconciliation to you.
Every unknown is fail-closed: an unresolvable upstream or a non-repository refuses rather than
passing quietly.

Two boundaries the pass states for itself, and you should not read past:

- **Uncommitted work is its own refusal.** `behind == 0` only says the *committed* tree is current;
  a working-tree edit can revert a shipped fix while the commit graph still reads clean.
- **Commit currency only — dependency currency is unchecked.** A tree level with the remote has
  still been found running its suite on an orphan vitest that answers a different question. That
  half is `scripts/vitest-version-guard.mjs`, which arms itself from each package's `globalSetup`.

#### On `main`, it arms itself — you do not have to remember (WIC-2228)

`scripts/tree-currency-autoarm.mjs` runs the same check from each package's `globalSetup`, so a
local checkout **on `main`** that is behind `origin/main` fails its own suite with no command typed.
An earlier revision of this section said the guard was deliberately kept out of `globalSetup`; that
held only for arming it *unconditionally*, which would hard-fail every CI run. The arm is
conditional, and it inverts exactly one half of the CLI's policy:

| | `npm run preflight` | the automatic arm |
|---|---|---|
| measured and behind | refuse | **refuse** |
| cannot measure (CI, no upstream, offline) | refuse | **skip, silently** |
| level but dirty | refuse | pass — commit graph only |

It arms only when `CI` is unset, the branch is `main`, it tracks `origin`, and `origin/main`
resolves. **A feature branch is never refused** — being behind `origin/main` is a defect on `main`
and a normal state on a branch. Dirt is not refused either, because editing a file and running the
tests is the whole inner loop; `npm run preflight` remains the strict check, and remains the thing
to run before you quote a result.

```bash
WIC_SKIP_TREE_CURRENCY=1 npm test    # escape hatch; the result then certifies nothing
```

### One TypeScript compiler, and `strict` is declared, not inherited

`typescript` is pinned to the same `~6.0.2` in the root, `packages/web` and `packages/api`, so
`npm ci` installs exactly one copy at `node_modules/typescript` and every cwd resolves it. Keep it
that way: if the three ranges drift apart, npm nests a second compiler under the package that
disagrees, and then **which compiler runs is decided by cwd rather than by config** — a root script
gets the hoisted one, `packages/web`'s own `build` (cwd `packages/web`) gets the nested one. That is
how `npm run typecheck` and `npm run build` came to disagree, with the root binary the weaker of the
two (WIC-1744).

`strict: true` is stated explicitly in `packages/web/tsconfig.app.json`, `tsconfig.node.json` and
`packages/api/tsconfig.json`. It is written out rather than left to default because the default
moved — TypeScript 6 turns `strict` on where 5.9 left it off — so an inherited default makes a
package's strictness a property of the installed version. Note that `tsc --showConfig` echoes only
options the file sets: it prints nothing for an inherited `strict`, so it cannot tell you which
default is in force. Do not delete these lines to "clean up"; they are load-bearing.

### `npm run build` is still the check that gates a PR

`npm run typecheck` and `npm run build` have historically disagreed, with **`npm run build` the stronger
of the two.** Measured on `7a9ee29` — the exact commit CI rejected — with both build caches cleared
first: `npm run typecheck` exited **0**, `npm run build` exited **2**. CI runs *both*, so the weaker
check going green told you nothing. Reproduce CI with the build:

```bash
rm -rf packages/*/node_modules/.tmp   # the tsbuildinfo files; CI never has one
npm run build                         # what `Lint & Test` → "Build packages" runs
```

That measurement predates the single pin above, and it had **two independent causes. The pin removes
the first; the second is still live.**

**Different compilers — fixed, and the fix is the pin.** `typescript` used to resolve twice: 5.9.3 at
the root and 6.0.3 nested under `packages/web`, so a root script got the weaker binary while
`packages/web`'s own `build` (cwd `packages/web`) got the stricter one. With `strict` inherited rather
than declared, that made the package's strictness a property of *which binary you invoked*. Verified on
an empty project: `export function f(x) { return x; }` is clean under 5.9.3 and `TS7006` under 6.0.3.
Both halves of that trap are now closed — one pin, and `strict` written out — which is exactly why
neither is safe to undo.

**Both are incremental, and CI is always cold.** `packages/web/tsconfig.app.json:3` and
`tsconfig.node.json:3` put `tsBuildInfoFile` under `./node_modules/.tmp/`, which `.gitignore:44`
ignores and `npm ci` never restores. Your machine always builds warm; CI always builds cold. The risk
is highest right after adding a new source file — the state a stale buildinfo has never seen. **This
one the pin does not touch**, so keep reproducing CI with the cache-clearing recipe above rather than
trusting a warm local run.

### Only import direct dependencies

A package that is merely a transitive dependency can resolve at runtime and still be invisible to `tsc`. The hoisted `dom-accessibility-api@0.5.16` (present via `@testing-library`) declares an `exports` block with `import` and `require` conditions and **no `types` condition**, so under `moduleResolution: bundler` TypeScript resolves the import to `dist/index.mjs` — the JavaScript — and reports `TS7016: Could not find a declaration file`, even though `dist/index.d.ts` is sitting beside it. That is the error that failed PR #224's first push. It used to be invisible to `npm run typecheck`, because under the root's non-strict 5.9.3 the same import silently became `any` — the weaker check did not merely miss the error, it accepted unchecked code. With one strict compiler over the repo both scripts now report it, which is the concrete payoff of the pin.

For accessible-name assertions use jest-dom's `toHaveAccessibleName`, which is declared and registered for every test file by `packages/web/src/test/setup.ts`. The helpers in `packages/web/src/test/prohibitedName.ts` carry the same instruction at the call site.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`): PRs get a preview Worker deploy; merges to `main` run DB migrations over the Supabase pooler, validate secrets, and `wrangler deploy` to production. See `docs/architecture/CI_CD.md`.

## Merging a PR

### ⛔ Never pass `--delete-branch` to a PR that has children stacked on it

`gh pr merge --delete-branch` deletes the head branch **regardless of the repository setting**. The repo has `delete_branch_on_merge: false` (verified 2026-09-05), so a plain `gh pr merge` leaves the branch alone — but the flag is a per-invocation override, not a request the setting can veto. Do not reason "the setting is off, so the flag is harmless."

When the deleted branch is some other PR's **base**, GitHub does not retarget that child onto the merged parent's base. It **closes the child**, unmerged, and does it as an automatic side effect with no prompt and no undo.

Measured, not hypothetical — it has happened **twice**, both times with the child closing exactly **2 seconds** after the parent merged:

| child | parent | parent merged | child closed | Δ | recovery |
|---|---|---|---|---|---|
| **#126** (WIC-1359) | #124 | `2026-08-27T04:55:08Z` | `04:55:10Z` | **2s** | reopened `05:12:18Z`, retargeted to `main` `05:12:20Z`, merged 08-29 |
| **#34** (WIC-808) | #33 | `2026-08-04T18:43:04Z` | `18:43:06Z` | **2s** | never reopened; re-landed as a fresh **PR #35** 36 min later |

Nothing was wrong with either child — the close was purely the base branch vanishing underneath it. #126 stranded the WIC-238 AC-10 returning-user bypass, so onboarding kept opening over established users' dashboards until someone noticed by hand.

**⚠️ Do not check this with `gh pr view` — the current state hides it.** #126 today reports `MERGED` with base `main` and looks entirely healthy, because the recovery reopened and retargeted it. The close is only visible in the timeline:

```bash
gh api repos/:owner/:repo/issues/126/timeline --paginate \
  -q '.[] | select(.event=="closed" or .event=="reopened" or .event=="base_ref_changed") | "\(.event)\t\(.created_at)"'
```

*(One board-side detail does not hold up: #126 was described as carrying "two `APPROVED` reviews". `GET /pulls/126/reviews` returns **empty** — it had none. That is expected rather than surprising, and it generalises: **agents cannot approve PRs here.** Every agent authenticates as `alwick`, who is the PR author, and GitHub 422s a self-approval. Any merge recipe that waits for an approving review will wait forever; use `--admin` instead, which is configured behaviour on this repo, not a bypass.)*

**The recipe for merging a stacked parent:**

1. **Retarget the children first**, while the parent's branch still exists — `gh pr edit <child> --base <parent's own base>`. Do this even if you intend to merge the children momentarily; it is what makes their close-on-delete impossible.
2. **Merge the parent with the flag omitted** — `gh pr merge <parent> --squash` (add `--admin` if a required check is blocking; see below).
3. Delete the branch by hand afterwards if you actually want it gone, once no open PR still names it as a base.

Check for children before merging anything:

```bash
gh pr list --state open --json number,baseRefName \
  -q ".[] | select(.baseRefName == \"$(gh pr view <parent> --json headRefName -q .headRefName)\") | .number"
```

Empty output means the flag is safe. Any number means it is not.

**There is deliberately no automated detector for this — do not re-scope one** (WIC-2106, closing
WIC-2095 / WIC-2089 item 2). Folding a check into `evil-merge-sweeper.yml` was evaluated against the
full closed-PR history and rejected on two measurements:

- **An hourly sweep is slower than the humans already are.** Both instances were recovered by hand in
  **2m02s** (#34) and **17m08s** (#126). The sweeper's cron is `17 * * * *` — mean latency ~30 min,
  worst case 60 — so a detector would have fired *after* the recovery both times, on both instances
  it exists to catch. Prevention (retarget children first, above) dominates detection here, and it is
  already written down.
- **The sweeper is the wrong host anyway.** It enumerates `state: 'open'` and publishes a per-head
  commit status the ruleset gates on. A closed PR has no gateable head, so there is no data to reuse
  and no output channel; and its closing `core.setFailed` means *"a PR could not be evaluated"*, which
  a permanently-red historical finding would corrupt.

⚠️ **If you do re-measure the rate, do not key the query on current state.** `closed-unmerged with a
non-`main` base` finds **#34 but not #126** — #126 was recovered, so it reads `MERGED`/base `main`
today. That query returns 5 rows over 399 closed PRs of which only #34 is the real shape, which
undercounts the true rate by half. The correlation (child `closedAt` − parent `mergedAt` ≈ 2s) is the
discriminator; the timeline above is the only complete source.

### Required checks live in a ruleset, not in branch protection

Classic `required_status_checks` on `main` is **absent** — `gh api repos/:owner/:repo/branches/main/protection/required_status_checks` returns 404, which reads like "no gate at all" and is misleading. Enforcement is the ruleset **`skip-ci-sweep-required`** (id `21489705`, `enforcement: active`, `include: ["~ALL"]`), which requires **two** contexts: `skip-ci-sweep` and `evil-merge-sweep`. Read `gh api repos/:owner/:repo/rulesets`, not the branch-protection API.

## Changelog conventions

Every change gets an entry under `## [Unreleased]` in `CHANGELOG.md`.

**The full conventions now live in [`docs/CHANGELOG_CONVENTIONS.md`](docs/CHANGELOG_CONVENTIONS.md)** —
moved there under WIC-2395, unchanged and still authoritative. It was 77% of this file, and this
file is loaded into every agent's context on every turn. **Read it before you edit `CHANGELOG.md`
or resolve a changelog merge**; the rules there are measured, not stylistic, and several are
load-bearing.

The four that bite hardest, so you know when to go read it:

- **Never anchor at the top of `[Unreleased]`** — it is a guaranteed insertion collision. Derive
  your anchor as *content* (which `### ` heading you land in front of), never as a line number.
- **Pad both edges of your inserted block with a blank line.** The `merge=union` driver eats the
  blank at the seam, welding the next `### ` heading onto your last bullet. A committed weld arms
  a worse failure for whoever branches off you next.
- **Never reformat a `CHANGELOG.md` line you are not otherwise changing** — union grades edits by
  position, not significance, so a cosmetic reflow becomes a semantic collision.
- **Keep `CHANGELOG.md merge=union` in `.gitattributes`, and keep the changelog out of the
  Prettier glob.** Both are load-bearing; the reasons are measured and recorded in the doc.

Run the checker before you push:

```bash
python3 scripts/changelog-union-check.py pr <n>       # against the PR's own base
python3 scripts/changelog-union-check.py selftest     # the fixtures, offline, ~2s
```

CI enforces the same script via `.github/workflows/changelog-union-guard.yml`. Note it checks what
the union *introduced*, **not** line conservation — see the doc for the check it does not cover.
