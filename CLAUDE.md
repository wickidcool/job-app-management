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

**Never anchor at the top of `[Unreleased]` — and don't take any other fixed position on faith. Measure, then insert where nobody else does.** Entries inside a release are same-day and effectively unordered, so being first buys nothing, and being first is what causes conflicts.

`.gitattributes` marks `CHANGELOG.md merge=union`. That auto-resolves the merge **locally**, and only locally: GitHub computes mergeability without the driver, so a changelog the driver "fixed" for you still reports `CONFLICTING / DIRTY` on the PR page and still blocks the merge button. The driver hides the conflict from you and not from GitHub, which is why these show up late.

Every one of those conflicts is the same conflict: an insertion collision on the **first `### ` heading under the `[Unreleased]` backfill note**. The merge base at that point is *empty* and both sides are pure additions, which is why the resolution is always "keep both" and why it always comes back. That anchor is also **branch-point independent** — the backfill note has sat directly above it since `1ea6186` (2026-08-04), so every open PR resolves "the top of `[Unreleased]`" to the same line no matter when it was cut. A guaranteed collision, by construction.

Anchoring below the top entry breaks that. "Below the current top entry" resolves to a *different* line depending on which `main` you branched from, so only PRs cut from the identical commit can still collide. Measured on PR #174: it edited `CHANGELOG.md` while #111, #165 and #166 were open and added **zero** new conflicts to any of them, where #169, #170 and #172 each took the top anchor and #170 alone broke both #165 and #166.

**That is a reduction, not a fix, and it decays as the advice is followed.** "Below the top entry" is itself a position, so once enough PRs take it, it becomes the new shared anchor — and PRs *are* commonly cut from the same `main`, which is the case the paragraph above assumes away. Measured 2026-08-29 across the 32 open `main`-based PRs that touch `CHANGELOG.md`: the top-of-`[Unreleased]` anchor carried **11**, and the two lines at the foot of the top entry carried **8** (#92/#93/#177/#232 on one, #171/#179/#208/#213 on the next). Two positions, 19 of 32 PRs. Everything from the third entry down was uncontended or held a single PR.

So derive the anchor instead of inheriting one. This prints the old-side start line of every open `main`-based PR's `CHANGELOG.md` hunks; insert somewhere absent from the output:

```bash
git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'
gh pr list --state open --limit 200 --json number,baseRefName \
  -q '.[] | select(.baseRefName == "main") | .number' |
while read -r n; do
  git rev-parse -q --verify "refs/remotes/pr/$n" >/dev/null || continue
  MB=$(git merge-base origin/main "refs/remotes/pr/$n")
  git diff -U0 "$MB" "refs/remotes/pr/$n" -- CHANGELOG.md | grep -oE '^@@ -[0-9]+'
done | sort | uniq -c | sort -rn
```

Restrict it to `main`-based PRs as shown. A stacked PR merge-based against `main` reports its
parent's hunks as well as its own, which inflates every position it touches.

**Any figure here is perishable — re-run it, never quote it.** A previous revision of this section recorded "every open PR inserts inside lines 8–58"; that was false within hours.

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
import re, sys, collections, difflib
L = open(sys.argv[1]).read().split('\n')
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()
bul, head, cur = collections.defaultdict(list), collections.defaultdict(list), None
for n, l in enumerate(L, 1):
    s = l.strip()
    if s.startswith('### '):
        cur = (n, s); head[norm(s)[:55]].append(n)
    if s.startswith('- ') and len(s) > 60: bul[norm(s)[:70]].append((n, cur))
sep = [n + 1 for n, l in enumerate(L) if l.startswith('### ') and n and L[n - 1].strip()]
print('duplicate headings:', {k: v for k, v in head.items() if len(v) > 1} or 'none')
print('headings missing a preceding blank line (line nos):', sep or 'none')
for k, v in bul.items():
    if len(v) < 2: continue
    hs = [h for _, h in v]
    r = difflib.SequenceMatcher(None, norm(hs[0][1]), norm(hs[-1][1])).ratio() if all(hs) else 0
    print('SAME-ENTRY' if len({h[0] for h in hs}) == 1 else
          'REVISION-PAIR' if r >= .75 else 'distinct entries',
          f'sim={r:.2f}', k[:60])
    for n, h in v: print(f'    L{n} under L{h[0]}: {h[1][:88]}')
PY
```

It compares a **normalised prefix**, not the whole line, because the duplicates that matter are
usually *reworded* — an earlier `Counter` over byte-identical lines could not see the WIC-1561 class
it was written for (WIC-1687). The tradeoff is deliberate: a prefix match will also flag genuine
pairs that merely open the same way, so **read both lines in full before acting — the discriminator
is the tail, not the prefix.**

**Do not read `duplicate headings: none` as a clean bill of health.** That check is high-precision
and low-recall: a duplicate `### ` heading has no benign case, so a hit is always a bug — but its
*silence proves nothing*, because a correction normally rewords the heading along with the body, and
the fixed 55-character prefix then sees two different strings. Measured 2026-08-29 on PRs #146
(`1a4b992`) and #160 (`c0d9089`): each carries the WIC-1309 fit-tier entry twice, once in the
retracted wording and once in the WIC-1319 correction, and the exact check reports `none` on both.
The two headings diverge at character **54** of the normalised string, one position inside the
55-char window. A whole-entry double-ship was invisible to the signal advertised as the reliable one,
by a single character. Widening the window cannot fix that — it makes the check stricter, not more
sensitive.

**So the bullet check is the sensitive one, and every hit is now reported with the `### ` entry it
sits under.** The enclosing headings are what tell you which of three different bugs you have:

- **`SAME-ENTRY`** — both copies under one heading. The union interleaved two revisions *inside* a
  single entry, so the entry now states a claim and its own retraction a few lines apart. Keep the
  corrected bullets, delete the superseded ones, leave the heading alone. (PR #117 today: four
  bullets where the entry should have two.)
- **`REVISION-PAIR`** — the copies sit under two near-identical headings. Union kept a whole entry
  *and* its rewrite. Delete the superseded entry entire, heading included, then re-check the seam.
  (PRs #146 and #160 today.)
- **`distinct entries`** — different, dissimilar headings. Almost always two real entries that merely
  open the same way. Both known-benign pairs on `main` land here (the boilerplate "Documentation
  only. No code, no tests…" opener at similarity 0.40, and the paired RLS "App runtime is
  unaffected…" bullets at 0.50), while the fit-tier double-ship scores 0.83.

The similarity is a *classifier on bullet hits*, not a standalone heading sweep. Run over every
`### ` pair instead it is too noisy to act on: on `main` at `eb40da8` a bare 0.75 threshold flags two
pairs that are genuinely distinct — the WIC-1373 and WIC-1365 catalog-scoping entries (0.81, different
services, different endpoints) and `UC-6: Resume Variant Generation` against `UC-4: Cover Letter
Generation` (0.75). Anchored to a shared bullet it produced zero false positives over the same file.

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

**Then run the checks on all three inputs, not just on `union.md`.** A hit in the merge result does
not mean the merge caused it: the same duplicate or weld may already be sitting in `ours.md` or
`theirs.md`. Report only what the union *adds* — `checks(union) − checks(ours) − checks(theirs)`.
Without that control the check cries wolf and gets ignored. Measured 2026-08-29 over the 51 open PRs
touching `CHANGELOG.md`, each simulated against its true base: the raw union output flagged **36**,
of which only **20** were introduced by the merge; the other **16** were already committed on the
branch or inherited from its base.

The distinction decides the fix, so it is not bookkeeping:

- **Union introduced it** → resolve the merge properly (per bullet, or delete the strict subset).
- **Already in the branch file** → the merge is innocent; edit the entry on the branch. Re-merging
  `main` will not help, and the raw-file hit is unconditional — it ships whatever the merge does.

Baselining against `main` instead of the PR's own base gets this backwards. Against `main`, PR #117
appeared to introduce three duplicate bullets; against its own base *and* its own head it introduces
**zero** — all three were already committed on the branch, which is a different bug with a different
owner.

**Counts in changelog prose rot.** An entry saying "all six `cursor` rows" was correct when written
and stale the same day, because another PR documented four more endpoints. Cite the rule the file
states, not a tally you took by grep (WIC-1567).
