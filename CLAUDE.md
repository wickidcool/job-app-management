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
  last bullet — even though *both* parents had the blank line (WIC-1567, fixed by #185). This is the
  most common of the three by a wide margin and has a one-line prevention: see
  "Start your entry with a blank line" below.
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

Measured 2026-08-30 across the 81 open PRs, of which **78** have a `CHANGELOG.md` differing from
their true base, each simulated in the real orientation with the content-addressed three-input
control: **11 will weld a `### ` heading onto the previous entry's last bullet** — #92, #93, #118,
#123, #149, #165, #171, #179, #208, #211, #248, all currently `main`-based (#211 and #248 weld two
headings each, so 13 welds across 11 PRs). The weld remains far the most common failure mode queued
to land. Run in the wrong orientation the same sweep reports 10, silently dropping #149.

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

**⛔ Which blank you need follows from that, and it is the opposite of what this file said until
2026-08-30.** The block that loses its separator is the one emitted *second*, and union emits
ours-then-theirs — so in the real orientation, where your PR head is `ours`, **your block is emitted
first and it is the blank at its *end* that gets consumed.** You need a **trailing** blank. The
previous revision prescribed a *leading* blank and stated flatly that padding the end "does
nothing"; that was measured with the sides swapped, and in the orientation that actually occurs it
is exactly backwards. Re-tested over all 11 welders by rebuilding each branch with an extra blank
added to each inserted run:

| variant | welders remaining, of 11 |
|---|---|
| as-is | **11** |
| extra **leading** blank | **11** — no effect |
| extra **trailing** blank | **1** |
| both | **1** |

Confirmed with a real merge rather than a simulation: PR #92 rebuilt each way and actually merged
with `git merge origin/main` in a scratch worktree welds with the leading blank and **does not weld
with the trailing one**. Keep doing both — the leading blank costs nothing, and the two known
benign-looking arrangements are cheap insurance against the next orientation surprise — but if you
only add one, **add the trailing one.**

**One of the eleven resists the remedy: #149 still welds with a trailing blank, and with both.** So
a blank-line discipline is a very good default, not a guarantee; the simulation is still the thing
that answers the question for your branch.

**Do not try to predict the weld from the anchor tally — sharing an anchor does not imply welding.**
Resolved to content anchors, the 13 welds sit on four seams: five onto
`### Fixed — onboarding no longer opens over an established user's dashboard…` (#123 #149 #165 #211
#248), five onto `### Fixed — The organic-traffic watcher…` (#171 #179 #208 #211 #248), two onto
`### Fixed — three of ONBOARDING_FLOW.md's eight Must-Have…` (#92 #93), and one onto
`### Documentation — The four remaining UC-5 report endpoints…` (#118 alone). But the single most
contended anchor in the file — the PRs stacked at the top of `[Unreleased]` — welds **zero** times.
Two structurally identical insertions, both placed after an existing blank and both
blank-terminated, differ only in how diff3 happened to align the *other* side's competing insertion.

So the anchor command answers "will GitHub call this CONFLICTING"; only the union simulation
answers "will the driver corrupt the result". Different questions, and their answers disagree.
Run the simulation.

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
