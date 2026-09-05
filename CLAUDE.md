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

npm run build              # Build all packages — the type check that actually gates a PR
npm run typecheck          # tsc -b web + api --noEmit — same compiler as the build (see below)
npm run lint               # Lint all packages
npm run test               # Unit tests (Vitest)
npm run test:e2e           # Playwright E2E tests

npm run db:migrate         # Run migrations (reads DATABASE_URL)
npm run db:push            # Push schema directly (dev only)
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

**Never anchor at the top of `[Unreleased]` — and don't take any other fixed position on faith. Measure, then insert where nobody else does.** Entries inside a release are same-day and effectively unordered, so being first buys nothing, and being first is what causes conflicts.

`.gitattributes` marks `CHANGELOG.md merge=union`, which auto-resolves the merge locally. **This section used to assert that GitHub ignores the driver, so that a changelog union "fixed" for you still reports `CONFLICTING / DIRTY`. That assertion is withdrawn — it is not reproducible.** Measured at `main` `78abadf` across all 98 open PRs: 48 `MERGEABLE` PRs touch `CHANGELOG.md`, 34 of those diverge from their base on that file, and **0 of the 34 collide with the driver disabled**. The discriminating case — a PR whose changelog merges *only* because of union — does not exist in the queue today, so neither answer has evidence behind it. **Do not remove the `merge=union` line, or migrate to changelog fragments, on the strength of a claim in either direction.**

What *is* reproducible is that the PR-page flag is stale. Of the 29 PRs GitHub currently calls `CONFLICTING`, only **three** have any genuine conflict, and none of the three is on `CHANGELOG.md`: #160 on `ApplicationsList.tsx`, #154 and #147 on `deploy.yml` and `docs/analytics/`. The other 26 each have a GitHub-computed two-parent merge commit at `refs/pull/N/merge` with zero conflict markers. **The changelog conflict backlog is 0.** Certify from that merge ref or from a real `git merge`, never from `mergeable` alone.

⚠️ **Measure a PR against the base its merge ref was computed at, not against today's `main`.** Every one of those 26 merge refs has an *older* `main` as its first parent. Replaying `head` vs current `main` reports all 26 as "would conflict without union"; replaying against `merge-base(p1, head)` reports **0 of 22**. Same PRs, same driver, opposite answer — the first number is an artifact of a moved base, and it is the same three-coordinate-systems error as the weld and anchor-tally checks below.

Historically, every changelog conflict this repo saw was the same conflict: an insertion collision on the **first `### ` heading under the `[Unreleased]` backfill note**. The merge base at that point is *empty* and both sides are pure additions, which is why the resolution is always "keep both" and why it always comes back. That anchor is also **branch-point independent** — the backfill note has sat directly above it since `1ea6186` (2026-08-04), so every open PR resolves "the top of `[Unreleased]`" to the same line no matter when it was cut. A guaranteed collision, by construction.

Anchoring below the top entry breaks that. "Below the current top entry" resolves to a *different* line depending on which `main` you branched from, so only PRs cut from the identical commit can still collide. Measured on PR #174: it edited `CHANGELOG.md` while #111, #165 and #166 were open and added **zero** new conflicts to any of them, where #169, #170 and #172 each took the top anchor and #170 alone broke both #165 and #166.

**That is a reduction, not a fix, and it decays as the advice is followed.** "Below the top entry" is itself a position, so once enough PRs take it, it becomes the new shared anchor — and PRs *are* commonly cut from the same `main`, which is the case the paragraph above assumes away. Measured 2026-08-29 across the 32 open `main`-based PRs that touch `CHANGELOG.md`: the top-of-`[Unreleased]` anchor carried **11**, and the two lines at the foot of the top entry carried **8** (#92/#93/#177/#232 on one, #171/#179/#208/#213 on the next). Two positions, 19 of 32 PRs. Everything from the third entry down was uncontended or held a single PR.

So derive the anchor instead of inheriting one — but **derive it as content, not as a line number.**
Each PR's hunk positions are in *its own merge base's* coordinates, and open PRs do not share one:
measured 2026-08-30, 49 open `main`-based PRs sit on **22 distinct merge bases**. Tallying raw
`@@ -N` values therefore compares numbers from 22 different coordinate systems — it splits one real
anchor across several N and merges unrelated anchors that happen to share an N. Both errors were
live: the eight PRs stacked on the top anchor span **five** merge bases, and PR #242 at `@@ -63`
and PR #211 at `@@ -116` are the *same seam*.

Only the top-of-`[Unreleased]` anchor is exempt, and only by construction — the backfill note has
sat directly above it since `1ea6186`, so line ~10 does mean the same thing in every base. That
exemption is exactly why the old line-number tally looked reliable: its single largest bucket was
the one position where it could not be wrong.

Resolve each hunk to the `### ` heading it lands in front of, and tally *that*. Insert before a
heading absent from the output:

```bash
git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'
gh pr list --state open --limit 300 --json number,baseRefName \
  -q '.[] | select(.baseRefName == "main") | .number' |
while read -r n; do
  git rev-parse -q --verify "refs/remotes/pr/$n" >/dev/null || continue
  MB=$(git merge-base origin/main "refs/remotes/pr/$n")
  git show "$MB":CHANGELOG.md > /tmp/mb.$$.md
  git diff -U0 "$MB" "refs/remotes/pr/$n" -- CHANGELOG.md |
    grep -oE '^@@ -[0-9]+' | tr -d '@ -' |
    while read -r at; do
      awk -v s="$at" 'NR>=s && /^### /{print substr($0,1,58); exit}' /tmp/mb.$$.md
    done
  rm -f /tmp/mb.$$.md
done | sort | uniq -c | sort -rn
```

Restrict it to `main`-based PRs as shown. A stacked PR merge-based against `main` reports its
parent's hunks as well as its own, which inflates every position it touches.

**Any figure here is perishable — re-run it, never quote it.** A previous revision of this section recorded "every open PR inserts inside lines 8–58"; that was false within hours.

**A clear anchor is necessary and not sufficient — check the conflict delta too.** Picking an
uncontended heading only means no *other* PR shares your seam today. Before you push, confirm your
change adds no conflict to any open PR, by running the `merge-file --diff3` check under "Diagnosing
one" for each open PR against `main`-with-your-change and against `main` without it, and comparing.
This section's own author picked a heading off a stale line-number tally, and that check is what
caught the collision with #242 before it shipped.

### Diagnosing one

`git merge`, `git merge-tree` and a local `git pull` all apply the union driver, so they report **clean** on a PR GitHub calls `CONFLICTING`. `git merge-file` is the low-level three-way merge and does not read `.gitattributes`, so it answers the *other* question — what the merge would do with the driver switched off. Run it to see what union is actually absorbing. **It is not a reproduction of "what GitHub sees":** that framing assumed GitHub ignores the driver, which is withdrawn above, and `git merge-tree` reads attributes from your *working tree* unless you pass `git --attr-source=<base> merge-tree` (before the subcommand, or git exits 129 and every pair reads as a conflict).

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
  **A "revision" here can be purely cosmetic and still collide** — changing `*emphasis*` to
  `_emphasis_` counts, because union grades edits by position, not by significance. See
  "A cosmetic reformat is a semantic collision" below.
- **Union ate the blank line between two entries.** Inserting a new entry directly above an existing
  one can consume the separator at the seam, leaving a `### ` heading welded to the previous entry's
  last bullet — even though *both* parents had the blank line (WIC-1567, fixed by #185). This is the
  most common of the three by a wide margin and has a one-line prevention: **write your inserted
  block so it both begins and ends with a blank line** — *both*, because the two merges your entry
  undergoes consume opposite edges, and because for two PRs on a shared base no per-branch
  arrangement is safe in every merge order (both measured below). **Do not treat the weld as
  cosmetic** — it is the precondition for the fourth
  mode; see "A weld you commit is a misfile you have armed for whoever branches off you next".
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
sep = {norm(l)[:55]: n + 1 for n, l in enumerate(L) if l.startswith('### ') and n and L[n - 1].strip()}
print('duplicate headings:', {k: v for k, v in head.items() if len(v) > 1} or 'none')
print('welded headings (normalised text -> line no):', sep or 'none')
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
- **`distinct entries`** — different, dissimilar headings. Both known-benign pairs on `main` land
  here (the boilerplate "Documentation only. No code, no tests…" opener at similarity 0.40, and the
  paired RLS "App runtime is unaffected…" bullets at 0.50), while the fit-tier double-ship scores
  0.83. **This label is not a verdict of benign** — it is also where the misfiling case lands, and
  the similarity score cannot tell the two apart. See "A copy filed under a heading neither parent
  used" below, and run that check before dismissing a hit in this class.

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
n=115; BASE=$(gh pr view $n --json baseRefName -q .baseRefName)
git fetch origin "+refs/pull/$n/head:refs/remotes/pr/$n"
MB=$(git merge-base "origin/$BASE" "refs/remotes/pr/$n")
git show "refs/remotes/pr/$n":CHANGELOG.md > ours.md    # PR head is OURS
git show "$MB":CHANGELOG.md                > base.md
git show "origin/$BASE":CHANGELOG.md       > theirs.md  # the base branch is THEIRS
git merge-file -p --union ours.md base.md theirs.md > union.md   # then run the checks above
```

Use `--union` here deliberately: the question is what the driver *will do*, which is the opposite of
the `merge-file`-without-driver check under "Diagnosing one" (that one asks whether GitHub sees a
conflict). Don't confuse the two.

**⛔ Put the PR head on the `ours` side — side order is not a convention, it changes the output.**
Union concatenates ours-then-theirs inside each differing region, so swapping the two files moves
where a duplicated bullet lands. The operation being simulated is the one every `CONFLICTING` PR
here must actually perform — `git checkout <pr-branch> && git merge <base>` — and `git merge` puts
the **current branch** on `ours`. That is the PR head, not the base. Verified 2026-08-30 on PR #115
by running the real merge in a scratch worktree and comparing: the `ours = PR head` simulation is
**byte-identical** to what `git merge` wrote; the `ours = base branch` simulation differs (first
difference at line 598).

Getting this backwards does not merely relabel the output, it **loses hits**, and it loses them
silently. Measured the same day over the 81 open PRs, 78 with a `CHANGELOG.md` differing from their
true base, `origin/main` at `ee6c217`:

| check | `ours = PR head` (real) | `ours = base branch` (wrong) |
|---|---|---|
| misfiled bullets | **1 PR** — #115 | **0 PRs** |
| welded `### ` headings | **11 PRs** | 10 PRs — misses #149 |

The wrong orientation is a strict subset in both rows: it found nothing the right one missed, and
missed a live defect in each. An earlier revision of this section shipped the wrong orientation and
reported the misfiling check as returning zero across the whole board; that zero was an artifact of
side order, not a clean board.

**Then run the checks on all three inputs, not just on `union.md`.** A hit in the merge result does
not mean the merge caused it: the same duplicate or weld may already be sitting in `ours.md` or
`theirs.md`. Report only what the union *adds* — `checks(union) − checks(ours) − checks(theirs)`.
Without that control the check cries wolf and gets ignored. Measured 2026-08-29 over the 51 open PRs
touching `CHANGELOG.md`, each simulated against its true base: the raw union output flagged **36**,
of which only **20** were introduced by the merge; the other **16** were already committed on the
branch or inherited from its base.

**Subtract by content, never by line number — `ours`, `theirs` and `union` are three different
coordinate systems.** This is the same error as the anchor tally (above), and it survived in the
weld control until 2026-08-30. Measured over the open PRs that day: subtracting *line numbers*
reports **17** PRs welding, subtracting *normalised heading text* reports **10**. All 7 extra are
false — the weld already sat on the branch and the merge merely shifted it down the file. PR #95's
weld is line 511 in `theirs.md` and line 600 in `union.md`; PR #117's is on **both** parents (169
and 78) and lands at 172; PR #168 carries the same **7** welds in `ours.md` and `union.md`, offset
by nine lines, and a line-number control blames the merge for every one of them. That is why the
check above prints normalised heading text as its key and the line number only as a locator: key on
the text, and the subtraction is merge-base independent.

The distinction decides the fix, so it is not bookkeeping:

- **Union introduced it** → resolve the merge properly (per bullet, or delete the strict subset).
- **Already in the branch file** → the merge is innocent, so the fix belongs to the branch — *if
  there is a fix owed at all.* Run the self-heal test below before you write anyone's name down.
  Most hits in this class repair themselves.

### A copy filed under a heading neither parent used — similarity cannot see this one

The three classes above all assume the two copies are competing for the *same* place in the file.
There is a fourth: union keeps both copies but files one of them under a **different `### ` entry**,
where it reads as a claim about a change it has nothing to do with. The superseded text stays in the
entry it belongs to, and the correction lands somewhere it does not. Two entries are now wrong
instead of one, and the surviving pair is *less* obviously duplicated than in the other three cases,
not more.

**Do not reach for a similarity threshold here — it is anti-correlated, in both places you would try
it.** Measured 2026-08-30 on PR #129 (`test/wic1371-stubdb-table-keyed`), which will do exactly this
on merge:

| pair | heading sim | bullet sim | truth |
|---|---|---|---|
| #129's WIC-1354 test bullet | 0.47 | **0.24** | **real misfiling** |
| `main`'s "Documentation only…" | 0.40 | 0.64 | benign |
| `main`'s "App runtime is unaffected…" | 0.50 | 0.68 | benign |

By *heading* similarity the real bug sits at 0.47, between the two benign exemplars — inside the
known-benign band, so the `distinct entries` label fires and the prose above used to invite
dismissal. Raising or lowering the threshold cannot separate them; the real hit is bracketed. Going
to *bullet* similarity instead inverts the ranking rather than fixing it: the genuine revision pair
scores **lowest of the three**, because a thorough correction rewrites the body it corrects, while
the benign pairs share long boilerplate openers. Either threshold, tuned either direction, ranks the
one real bug below both false ones.

The discriminator is structural and needs no threshold. **A bullet belongs under exactly one
heading. If the union filed a copy under a heading that neither parent filed it under, the union
misfiled it** — there is no benign reading, and the test is merge-base independent because it keys
on heading text rather than position:

```bash
python3 - ours.md theirs.md union.md <<'PY'
import re, sys, collections
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()
def homes(p):
    h, cur = collections.defaultdict(collections.Counter), ''
    for l in open(p):
        s = l.strip()
        if s.startswith('### '): cur = norm(s)[:60]
        elif s.startswith('- ') and len(s) > 60: h[norm(s)[:70]][cur] += 1
    return h
o, t, u = map(homes, sys.argv[1:4])
hit = False
for k, heads in u.items():
    parents = set(o.get(k, {})) | set(t.get(k, {}))
    if not parents: continue          # in neither parent: not this class
    for h, n in heads.items():
        if h not in parents:          # (1) filed where NEITHER parent filed it
            hit = True
            print('MISFILED  ', k[:60], '\n    now under:', h[:80])
        else:                         # (2) more copies under one heading than either parent had
            pmax = max(o.get(k, {}).get(h, 0), t.get(k, {}).get(h, 0))
            if n > pmax and n > 1:
                hit = True
                print(f'DUPLICATE x{n} (parent max {pmax})', k[:60], '\n    under:', h[:80])
print('clean' if not hit else '')
PY
```

**Run both halves — they catch the same corruption in different orientations, and neither is a
superset of the other.** A bullet that union both duplicates *and* relocates presents as MISFILED
when the copy lands under a foreign heading, and as DUPLICATE when both copies land under the same
one. Which of the two you get depends on side order, so a check that only looks for one of them goes
quiet exactly when you swap the inputs. Measured on WIC-1768's own fixture (PR #129 at its pre-fix
head `97989e6`, merge base `3714e956`, `main` at `743cfeb`) — the same three files, differing only
in which side is `ours`:

| orientation | MISFILED | DUPLICATE |
|---|---|---|
| `ours = PR head` (the real merge) | 0 | **1** |
| `ours = base branch` | **2** | 0 |

One corruption, two presentations, and the presentation flips with side order. Since you should only
ever run the real orientation, the misfiling check *alone* would have reported that PR clean. Note
also that **two** bullets travel together there, not one — the `stubDb` test-double bullet moves with
the WIC-1354 bullet — so a hit count is not a defect count.

Run it on the same three files the union simulation already produced. Across the 81 open PRs on
2026-08-30 — 78 with a `CHANGELOG.md` differing from their true base, `origin/main` at `ee6c217` —
it returns **exactly one hit, #115, and no false positives**, and it stays silent on both
known-benign `main` pairs that the similarity classifier flags every run.

**PR #115 is the live worked example, and it is the reason the orientation matters.**
`fix/wic1181-post-delete-focus` → `fix/wic1141-modal-focus-pr2` (stacked), head `7890a2c`, merge base
`88478f0b`, `CONFLICTING / DIRTY` — so it *must* take its base in, in exactly the orientation that
exposes this. The bullet **"Background hiding is asserted twice — on the trigger's reachability and
on `#root[aria-hidden]`"** is the WIC-1758 correction: it lives on the base branch under
`### Accessibility — Focus management on the remaining five dialogs`, and the merge files it under
the sibling entry `### Accessibility — Focus management on the destructive-delete confirmation` —
same date, near-identical heading, a change it has nothing to do with. Meanwhile the *superseded*
wording it was written to replace ("asserted on the trigger's reachability, **not** on
`#root[aria-hidden]`") survives untouched in the entry it belongs to. Two entries wrong, the
retracted claim republished, and the correction filed where nobody will read it — with no conflict
shown and a successful exit. Filed as WIC-1786.

The #129 instance is worth keeping as the second worked example, because it closed. At head `97989e6` the
PR was `CONFLICTING / DIRTY`, so its author had no path to merge that avoided running the driver
over this file, and the driver would have resolved it silently and reported success. Its branch file
was clean — both parents carried only the two benign pairs, the union carried three. Filed as
WIC-1768; the owner merged `main` in and resolved the hunk per bullet in `a7a13fb`, and the PR went
`MERGEABLE`. Re-measured at that head: union clean on all three checks, the bullet present once in
its corrected form under the entry it belongs to, and the seam it left behind un-welded.

**Re-measure an accusation immediately before you act on it.** This one was written against
`97989e6` and was already fixed at `a7a13fb` by the time the entry describing it was ready to merge
— a gap of well under an hour. The pre-merge re-measure is what caught it; without that step this
file would carry a present-tense accusation against a branch that had already complied, with a green
check on it. A claim about someone else's branch is exactly as perishable as a board ask.

**Write your inserted block so it both begins and ends with a blank line**, i.e. the run of `+`
lines in `git diff` starts with a blank and ends with a blank, on top of the separator already in
the file. Check the shape of the `+` run in `git diff`, not whether the file "looks" spaced.

**Do not run Prettier over `CHANGELOG.md`, and do not widen the format glob to reach it — the
formatter deletes the pad you just added.** `format` and `format:check` are scoped to
`packages/**/*.{ts,tsx,css,md}`, so the root changelog sits outside every gate the repo has; a
Prettier editor plugin on format-on-save ignores that glob entirely, which is the realistic way this
happens to you. Measured 2026-08-30 with the pinned Prettier 3.8.3, `--parser markdown` over the
whole file at `main` = `e3533d7`: the reformat removes **10 blank lines, and every one of them sits
immediately above a `### ` heading** — eight entry seams, which is exactly the leading padding the
paragraph above prescribes. The count moves with the file; the ratio is the durable part.
Prettier collapses any run of blank lines to one and cannot tell a separator from a pad, so widening
the glob would strip the remedy from eight entries in one commit and re-arm the weld on each. The
two conventions are in direct conflict, the padding wins, and the changelog stays out of the
formatter's scope on purpose.

**Never escape a backtick inside a code span — CommonMark ignores the escape, and the mis-parse is
silent and total.** The escape does not stop the backtick from closing the span, so the span ends
early and every code span in the rest of the paragraph inverts: prose renders as code and the code
fragments render as prose. Measured on the WIC-1377 entry, which carried
`` sql`…` `` written the escaped way: **all 8** code spans in that paragraph were prose, and its
`**parameter list**` reached the rendered page as literal asterisks. Prettier then faithfully
re-serialises that inverted tree, and because a code span needs no surrounding whitespace the reflow
**eats word-boundary spaces**, while exiting 0 and reporting success. Use the padded double-backtick
form, which round-trips through Prettier unchanged (WIC-1732):

```markdown
wrong:  `sql\`${companyCatalog.id} = ANY(${sourceIds})\``
right:  `` sql`${companyCatalog.id} = ANY(${sourceIds})` ``

what the wrong form costs on the next reformat, silently, in prose nobody edited:
  ... interpolated into a `sql`template as a comma-separated ...
  ... `($1, $2)`is a row constructor and `= ANY(...)`requires an array ...
```

The two padding spaces just inside the doubled delimiters are load-bearing: CommonMark strips one
leading and one trailing space from a code span, and without them the span's own trailing backtick
runs into the closing delimiter. Render-check any paragraph that mixes code spans with literal
backticks — this class is invisible in the source and shows up only in the parsed output.

Re-measured 2026-08-30 at `main` = `30b61a2`, across the 86 open PRs, of which **82** have a
`CHANGELOG.md` differing from their true base, each simulated in the real orientation with the
content-addressed three-input control: **9 will weld a `### ` heading onto the previous entry's last
bullet** — #92 `78ac9f8`, #93 `8ca23e5`, #118 `aaf4b75`, #123 `24f4f5e`, #149 `8d68c7f`, #165
`309d97c`, #171 `a0e370c`, #179 `70c7652`, #208 `b4b87c6`, one weld each, all currently `main`-based.
Those figures are from the re-run taken **immediately before this revision merged**, not from the
draft: the population had already grown by three PRs while the entry was being written, though the
roster and every head SHA in it were unchanged.
The weld remains far the most common failure mode queued to land. Run in the wrong orientation the
same sweep reports one fewer, silently dropping #149.

**Quote every accused PR at a head SHA, and re-run the sweep — not a spot check — immediately before
you merge.** The revision that shipped this paragraph named **11** PRs including #211 and #248, and
both had already been repaired by the DevOps Engineer (`f4df7af` 08:13Z, `cb8e641` 08:16Z, each
commit message reading *"repair two union-driver welds"*) **before that PR was even opened** at
08:19Z, let alone merged at 09:29Z. So this file shipped a stale accusation with a green check on
it — the exact outcome the pre-merge re-measure exists to prevent, and the first time it has reached
`main` rather than being caught in draft. The discipline did not fail because it was forgotten; it
failed because the accused set had grown from one branch to eleven, and re-checking eleven by hand
is work that quietly gets skipped. **Re-run the same command that produced the roster** — it is one
sweep, not eleven checks — and let the diff in the roster be the answer. The two dropouts are also
the good news in this section: the blank-line discipline is being adopted and it works in practice,
on a single branch merging its own base in. (Which edge, and when that is not enough, is below.)

**Do not restrict this sweep to `main`-based PRs.** An earlier revision reported nine welders and
asserted all were `main`-based, while a stacked PR was welding against its own base the whole time
and was simply outside the population measured. A stacked PR welds against *its own base branch*
exactly as readily; whether today's cohort happens to be `main`-based is an accident of what has
merged this week, not a property of the defect.

**Every one of those branch files is individually weld-free, and so is `main`.** The defect exists
only in the merge result, which is why nothing on the PR page shows it and why the pre-push
simulation is the only thing that can.

The cause is that both sides insert at the same blank-line separator. The base holds that blank
once; union emits both insertion blocks around it, the **first** block keeps the blank, and the
**second** block's heading lands directly against the first block's last bullet.

**⛔ The blank that gets eaten is the one at the join between the two competing insertions — which
is a different edge of *your* block depending on which merge you are looking at.** Union emits
ours-then-theirs, so the block emitted **first** loses the blank at its **end** and the block emitted
**second** loses the blank at its **start**. Those are not two blanks. They are the same physical
line in the merged file, named from the two sides of it.

Every entry goes through two merges, and they point in opposite directions:

| the merge | who is `ours` | the edge of your block at the join |
|---|---|---|
| **pre-push** — `git merge <base>` on your branch, to clear `CONFLICTING` | your PR head | its **trailing** edge |
| **landing** — `main` or your base branch takes your PR | the base | its **leading** edge |

Measured 2026-08-30 by running one pair of inputs both ways — PRs #188 (`fcc5e4e`) and #180
(`c6cf108`), siblings on `fix/wic1478-dashboard-attention-aggregates` (`a18981e`), `main` at
`a46c63a`. `main` merges #180 in: the weld lands on **#180's**
heading, its leading blank consumed. #180's branch merges that same `main` in: the weld lands on
**#188's** heading, and the blank that went is #180's *trailing* one. Same two files, opposite
direction, opposite edge.

**So pad both edges, and treat the old tie-break as retired.** A previous revision of this section
said "if you only add one, add the trailing one." That is right for the pre-push merge and wrong for
the landing merge — and it is the landing merge that publishes a weld to `main`, where it arms the
misfile for every branch that subsequently merges `main` (next section). Of the two, the leading
blank is the one with the larger blast radius. Add both, and stop choosing.

The table below stands as measured, and what it measured was the **pre-push** merge only. Re-tested
2026-08-30 at `main` = `30b61a2` over all 9 then-current welders by rebuilding each branch with an
extra blank added to each inserted run:

| variant | welders remaining, of 9 |
|---|---|
| as-is | **9** |
| extra **leading** blank | **9** — no effect |
| extra **trailing** blank | **1** |
| both | **1** |

Confirmed with a real merge rather than a simulation: PR #92 rebuilt each way and actually merged
with `git merge origin/main` in a scratch worktree welds with the leading blank and **does not weld
with the trailing one**.

**One of the nine resists the remedy: #149 still welds with a trailing blank, and with both.** So
a blank-line discipline is a very good default, not a guarantee; the simulation is still the thing
that answers the question for your branch. **And it is a prevention, not a repair** — it stops a
weld being created, it does nothing about one already committed, and once a committed weld reaches a
merge base you share with someone the damage is no longer yours to undo (next section).

#### Two PRs on a shared base: the remedy is order-dependent, and it does not compose

Everything above treats the blank as something you can get right on your own branch. For **sibling
PRs stacked on the same base** that is not true, and the failure is not a corner case — it is the
arrangement the advice above produces if both authors follow it.

When two siblings insert at the same seam, their entries land adjacent to each other on `main`, so
the contested join is *between the two of them*. The edge that needs padding therefore belongs to
whichever sibling merges **second** — and merge order is not under either author's control.

Measured 2026-08-30, `main` = `a46c63a`. PRs #188 (`test/wic1574-…`, `fcc5e4e`) and #180
(`fix/wic1497-…`, `c6cf108`), siblings on `fix/wic1478-…` (`a18981e`). Every figure is the weld
count on the simulated post-merge `main`, from
a real `git merge` in a scratch worktree with the union driver active. Control: **all ten input refs
are individually weld-free**, and so is `main`, so every weld below is introduced by the merge.

| extra blank added | order 160, 188, 180 | order 160, 180, 188 |
|---|---|---|
| none | 1 | 1 |
| leading, on #188 | 1 | **0** |
| leading, on #180 | **0** | 1 |
| leading, on both | 1 | 1 |
| trailing, on #188 | **0** | 1 |
| trailing, on #180 | 1 | **0** |
| trailing, on both | 1 | 1 |
| **both edges, on #188 only** | **0** | **0** |
| **both edges, on #180 only** | **0** | **0** |
| **both edges, on both** | 1 | 1 |

Three things follow, and the third is the one that matters:

- **Every single-edge remedy is order-dependent.** Each works in exactly one of the two orders and
  welds in the other. Since the weld always lands on the heading of whichever sibling merges second,
  and neither author schedules that, no single-edge choice is safe.
- **Padding both edges of exactly one sibling is clean in both orders** — the only arrangement here
  that is. This is why the standing advice is *both* edges, not a tie-break between them.
- **Padding both edges of both siblings welds in both orders, exactly as badly as padding neither.**
  So the obvious move — every author applies the documented remedy to their own branch — is
  precisely the arrangement that fails.

That last row means **the remedy is not composable, and you cannot reason about your edge one branch
at a time.** The blanks are real lines that travel with their blocks, so adding one at an
*uncontested* seam changes how diff3 aligns the contested one. With a leading blank on both
siblings the merged file ends up carrying a visible stray double blank above the first entry and
still welding at the join below it: the padding moved to a seam nobody was competing for, and the
one that was contested was eaten anyway.

**So for siblings on a shared base, prevention is not something either author can apply
unilaterally.** Two honest options: coordinate, so that exactly one of the two pads both edges and
the other leaves its block alone; or accept that the check on the merge *result* is the only
control. Prefer the second — it does not require the two authors to be awake at the same time.

**Whoever merges the second of two siblings owns running that check,** in the merge commit, before
pushing. That is the first moment the two blocks are adjacent, so it is the first moment the weld
either exists or does not, and it is the last moment before it becomes a committed weld in a merge
base other branches will inherit. Neither PR page shows it, and both branch tips report clean.

**CI now runs this check — but the pre-push discipline above still stands.** All four checks in this
section are enforced by `.github/workflows/changelog-union-guard.yml`, which runs
`scripts/changelog-union-check.py` on every PR (`pull_request_target`, so a CONFLICTING PR is still
reached — a `pull_request` trigger would go quiet on exactly the population that matters), hourly
across every open PR, and on every push to `main` (WIC-2103, closing WIC-1792 / WIC-2087). Run it
yourself before you push:

```bash
python3 scripts/changelog-union-check.py pr <n>       # against the PR's own base
python3 scripts/changelog-union-check.py refs --ours <your-branch> --theirs <its base>
python3 scripts/changelog-union-check.py selftest     # the fixtures, offline, ~2s
```

The script is the executable form of everything in this section — the same orientation, the same
content-addressed keys, the same three-input subtraction — so if the two ever disagree, one of them
is a bug. **CI catching it is not as good as not committing it**: by the time the guard is red on
your PR, a weld you merged has already entered a merge base your children inherit, and this section
records why that is no longer yours to undo.

**Do not try to predict the weld from the anchor tally — sharing an anchor does not imply welding.**
Resolved to content anchors, the 9 welds sit on four seams: three onto
`### Fixed — onboarding no longer opens over an established user's dashboard…` (#123 #149 #165),
three onto `### Fixed — The organic-traffic watcher…` (#171 #179 #208), two onto
`### Fixed — three of ONBOARDING_FLOW.md's eight Must-Have…` (#92 #93), and one onto
`### Documentation — The four remaining UC-5 report endpoints…` (#118 alone). But the single most
contended anchor in the file — the PRs stacked at the top of `[Unreleased]` — welds **zero** times.
Two structurally identical insertions, both placed after an existing blank and both
blank-terminated, differ only in how diff3 happened to align the *other* side's competing insertion.

So the anchor command answers "will GitHub call this CONFLICTING"; only the union simulation
answers "will the driver corrupt the result". Different questions, and their answers disagree.
Run the simulation.

### A cosmetic reformat is a semantic collision

**Never reformat a `CHANGELOG.md` line you are not otherwise changing.** Every pre-existing line your
branch rewrites — even if only `*emphasis*` → `_emphasis_`, even if it renders identically — becomes
a collision candidate. Union compares positions, not meaning: if `main` also edits that line before
you land, both copies survive, and the reader gets one bullet twice in two different states of truth.

The damaging direction is the likely one. `main`'s edits to an *existing* entry are overwhelmingly
**corrections**, because that is the only reason anyone goes back to a shipped entry. So the pairing
is almost always your stale copy against `main`'s corrected copy — and union emits yours first,
putting the retracted claim above its own retraction.

Measured 2026-08-30, `main` at `3b0c0d3`, PR #209 head `fdd800d`: nine pre-existing lines rewritten
with emphasis-only changes, one of which `main` had corrected four hours earlier in `70396b0`. The
merge carried that bullet twice — the uncorrected copy first — and the union simulation was
byte-identical to a real `git merge origin/main` in a scratch worktree, so that is what would have
shipped. Filed as WIC-1884 and fixed the same day in `cdb1c24`, which reverted all nine; at head
`2085803` the union introduces nothing.

Across all 100 open PRs, **four** still carry emphasis-only rewrites of pre-existing lines — #299
(91 lines), #261 (48), #249 (10), #226 (2), **151 lines total**, none of them colliding today. They
are dormant purely because `main` has not touched those lines yet, and each converts the moment it
does.

⚠️ **Re-measure this roster immediately before you quote it anywhere.** #209 went from nine lines to
zero in the interval between this section being drafted and the PR carrying it being merged. A
roster of accused branches is the fastest-decaying thing in this file: quote every entry at a head
SHA, and re-run the sweep — diffing the roster — right before you push.

That the dormant ones are one edit from live is a controlled result, not an inference. Run it on any
branch in the roster: take a line it only reformatted, synthesise a `main` that appends a correction
to that line, and re-run the union — copies go **1 → 2**, while the negative control with `main`
untouched stays at **1**. Measured on `fdd800d`, which still carried eight such lines at the time.

**This is the second independent reason `format` and `format:check` stay scoped to `packages/**` and
exclude root `CHANGELOG.md`** (the first is that prettier strips the blank line above every `### `
heading, re-arming the weld on every entry at once — WIC-1732). The scoping is load-bearing. Do not
widen it, and do not "tidy" the changelog as a drive-by.

The fix on a branch that already did it is to **restore the original spelling on every line you only
reformatted**, keeping whatever you genuinely add. Byte-identical lines give union nothing to
resolve, which retires the latent cases too. Fixing it after the merge does not work: the corruption
exists only in the merge result, so there is nothing to see on either branch until it has shipped.

⚠️ **The byte-exact multiset conservation check cannot see this class.** The two copies are
*different strings* — that is the whole point — so no line is lost and no line count changes. Only
the normalised-prefix bullet check in the detector above catches it. This is the concrete case the
prefix normalisation was worth paying for.

### A weld you commit is a misfile you have armed for whoever branches off you next

The weld reads like a formatting nit — one missing blank line, nothing lost. It is not. A `### `
heading welded to the previous entry's last bullet is **inside that bullet's diff3 region**, so the
next ordinary edit to that bullet drags the heading along with it, and union files the edited copy
under whichever entry it lands after. The weld does not corrupt anything by itself; it converts the
*next* routine change into the fourth failure mode above.

Watched end to end on live branches, 2026-08-30, all four steps inside two hours:

1. **07:25Z** — a routine `git merge origin/main` on `fix/wic1478-dashboard-attention-aggregates`
   welds `### Fixed — onboarding no longer opens…` onto the previous entry's last bullet. The driver
   reports success. The weld is **committed** in the merge commit `2f3efb8`. Every commit on that
   branch before it carries zero welds, so the merge is unambiguously where it came from.
2. That commit becomes the **merge base shared with two stacked children**, PRs #188 and #180.
3. **08:18Z** — #188's author notices the weld and repairs it *on their own branch* (`19543ab`,
   "restore the blank line before the onboarding entry"). This buys them nothing.
4. **09:33Z** — the parent edits that welded bullet, a one-line change extending it (`05bb701`).
   Both children's merges now file the **corrected** copy under a foreign heading while the
   superseded copy keeps the right home — and under **two different** foreign headings, `### Tests —
   The Dashboard attention aggregates…` in #188 and `### Fixed — moving a kanban card…` in #180,
   which is on its own enough to prove the merge invented the placement rather than inheriting it.

One push, two corrupted children, neither of whose authors did anything wrong. The counterfactuals
are what make it actionable — same three inputs, only the welds removed:

| base branch's `CHANGELOG.md` | #180 | #188 |
|---|---|---|
| as-is | MISFILED | MISFILED |
| weld repaired **today**, on the parent | **MISFILED** — no help | **MISFILED** — no help |
| weld never committed (merge base clean too) | clean | clean |

**So the repair window closes when the weld enters a merge base you share.** Fixing it on the parent
afterwards is just another edit in the contested region; it cannot reach back into the base the
children branched from. This retires the reassurance an earlier revision of this file offered about
the weld backlog — that each welder "self-resolves once its author adopts the convention". Adopting
the convention late does not undo what is already committed, and it does nothing at all for anything
already stacked on you.

Two concrete rules follow:

- **Never commit a weld.** Run the check above after *every* `merge main` that touches
  `CHANGELOG.md`, not just before a push, and repair it in that same commit. A weld caught before it
  is committed costs one blank line; the same weld caught two hours later cost two PRs.
- **If you own a branch other PRs are stacked on, you are a shared surface.** Check the seam before
  you push a `CHANGELOG.md` edit, and tell your children when you have touched an entry near one.

### Before accusing a branch, ask whether `main` already fixes it

A previous revision of this section said that when a hit is already committed on the branch,
"re-merging `main` will not help." That is wrong, and wrong in the direction that manufactures false
accusations. Measured 2026-08-30 across the ten open PRs still carrying the WIC-1319 retracted
fit-tier claim — `main` carries zero, PR #204 deleted it — **nine of the ten repair themselves the
next time `main` is merged in.** Exactly one does not.

The discriminator is a single question: **is the offending text in `git merge-base origin/main
<branch>`?**

- **Present in the merge base** → the branch is a *passenger*. `main`'s correction is a deletion
  relative to a shared ancestor, so it is a one-sided change: the three-way merge applies it cleanly
  and the union driver is never consulted for that region. The stale text is absent from the merge
  result whether or not the author ever merges `main` themselves. **Do not file a card, do not edit
  the branch, do not name it in an entry.**
- **Absent from the merge base** → the branch *owns* the text. `main`'s deletion has nothing to
  attach to, so there is no correction to propagate and merging `main` forward will never remove it.
  Only a hand edit on the branch fixes it.

Owning it is what a *committed* union result looks like. On PR #117 the duplicate arrived inside
merge commit `508289b` (`fix/wic1309-fit-tier-blurbs` merged into `copy/wic1318-fit-tier-blurbs`) at
a moment when the source branch still held the retracted wording. That source branch has since been
corrected and now measures clean — but #117 committed the driver's output, converting a transient
merge artifact into a branch-side addition. **The union driver's damage becomes permanent at the
instant it is committed**, which is the practical reason to run the pre-push simulation instead of
trusting a clean `git merge`.

```bash
Q='would have appeared directly above a match count of 20/20'   # the offending text
for ref in refs/remotes/pr/146 refs/remotes/pr/117; do
  MB=$(git merge-base origin/main "$ref")
  printf '%-22s mergebase=%s branch=%s\n' "${ref#refs/remotes/}" \
    "$(git show "$MB":CHANGELOG.md          | grep -c "$Q")" \
    "$(git show "$ref":CHANGELOG.md         | grep -c "$Q")"
done
# mergebase=1 → passenger, self-heals.   mergebase=0 branch=1 → owner, needs a hand edit.
```

**Run the self-heal test against `origin/main`, not against the PR's true base** — the opposite of
the union simulation above, and for a different reason: the simulation asks *what will this merge
produce*, so it needs the base the merge actually uses; the self-heal test asks *where does the
correction live*, and the correction lives on `main`. A stacked PR whose immediate base still carries
the stale text is not thereby an owner. #191 and #123 both show the duplicate in a union against
their own bases, and both are passengers against `main`.

**⛔ "Passenger" predicts self-healing only while the deletion stays one-sided — and the union
driver is what breaks that.** The passenger argument above depends on the three-way merge seeing a
clean one-sided deletion, which it only does if the *other* side leaves that region alone. When both
sides touch it, the region becomes a conflict region, the union driver is consulted after all, and
it concatenates instead of applying the deletion — so the superseded text survives a merge the test
says will remove it. PR #115 is the worked counterexample: the retracted "asserted on the trigger's
reachability, **not** on `#root[aria-hidden]`" wording is present in its merge base (`88478f0b`), so
the test says *passenger, self-heals, file nothing* — and the real `git merge` keeps it anyway,
because #115 inserted its own entry directly against the same seam. **Confirm with the round trip
below before trusting a passenger verdict on any branch that also edits near the correction.**

**And run it against whichever ref carries the correction, which for a stacked PR is usually its
base branch, not `main`.** #115's correction lives on `fix/wic1141-modal-focus-pr2`; `origin/main`
carries neither wording, so the against-`main` form of this test is simply uninformative there
rather than wrong. Read where the fix actually landed before picking the ref.

Confirm with the round trip rather than the counts alone — merge `main` into the branch, then merge
that result into `main`, and run the checks on the output. On #146 the final file has zero
occurrences and the detector is clean; on #117 it retains the retracted claim and both `SAME-ENTRY`
bullet pairs.

The cost of not having this test was real. The affected set filed on 2026-08-29 named PRs #146 and
#160: #146 is a passenger, and #160's branch (`494d49d`) now measures zero occurrences outright.
Neither was ever actionable. Today's sweep finds the text on ten branches and exactly one of them —
#117, already tracked under WIC-1677 and blocked — is work anybody owes. **A hit tells you the text
is present; only the merge base tells you whether it is a problem.**

Baselining against `main` instead of the PR's own base gets this backwards. Against `main`, PR #117
appeared to introduce three duplicate bullets; against its own base *and* its own head it introduces
**zero** — all three were already committed on the branch, which is a different bug with a different
owner.

**Counts in changelog prose rot.** An entry saying "all six `cursor` rows" was correct when written
and stale the same day, because another PR documented four more endpoints. Cite the rule the file
states, not a tally you took by grep (WIC-1567).
