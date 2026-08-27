# ADR-009: Per-PR Changelog Fragments

## Status

Proposed

Supersedes the *mechanism* of WIC-1157 (`CHANGELOG.md merge=union`) and WIC-1543 (below-top
insertion anchor). It does not overturn either finding — both were correct, both were measured,
and the measurements below reuse WIC-1543's methodology.

## Context

`CHANGELOG.md` carries one `### ` entry per change, all of them inserted under a single
`## [Unreleased]` heading. Every pull request therefore edits the same region of the same file,
and the first PR to merge invalidates the others.

### The category, not the incident

Eleven board cards have been opened, worked and closed by performing the same manual re-merge:
WIC-1157, WIC-1303 (cancelled), WIC-1363, WIC-1368, WIC-1375, WIC-1376, WIC-1486, WIC-1513,
WIC-1543, WIC-1552, WIC-1561. Each was individually cheap — a merge, a push, a CI run, and a
`skip-ci-sweeper` dispatch to re-publish the required commit status. None of them was ever priced
against the others.

### What is actually true, measured three times

All three censuses were reproduced with the low-level three-way merge — the one tool that does
**not** read `.gitattributes` and therefore answers the same question GitHub's merge button asks —
with the positive control from `CLAUDE.md` passing.

| Measurement | `main @13cb1e3` (08-27 ~00:30Z) | `main @3396925` (08-27 ~03:35Z) | `main @bf0b18e` (08-27 ~05:10Z) |
|---|---|---|---|
| Open PRs | 58 | **62** | **67** |
| Open PRs touching `CHANGELOG.md` | **40 (69%)** | **47 (76%)** | **48 (71%)** |
| Currently `CONFLICTING / DIRTY` | **6** | **13 (21%)** | **10 (21%)** |
| Conflict sets **containing** `CHANGELOG.md` | **6 of 6 (100%)** | **13 of 13 (100%)** | **9 of 10 (90%)** |
| Conflict sets that are **exactly** `CHANGELOG.md` | 6 of 6 | **9 of 13** | **8 of 10** |
| Open changelog-touching PRs parked in `REVIEW_REQUIRED` | 22 | — | — |
| Merges to `main`, trailing 7 days | 126 | — | — |
| Of those, merges touching `CHANGELOG.md` | **76 (~11/day)** | — | — |
| Git tags / published releases | **0** | — | — |
| `CHANGELOG.md` size | 573 lines, 146 KB, one never-cut `[Unreleased]` | — | — |

The claim to state is a **necessary-condition** one rather than a sole-cause one, and as of the
third census it is a *near*-necessary condition with one understood exception:

> `CHANGELOG.md` appears in the conflict set of **9 of 10** conflicting open PRs. Removing the
> shared line would take the conflict count from **10 to 2**.

This has now been corrected twice, in the same direction both times — each census weakens the
claim slightly, and each time the weaker version is the more useful one.

- The **first** revision stated the sole-cause form — *"for all 6 the conflict file set is exactly
  `CHANGELOG.md`"* — true at `13cb1e3`, false at `3396925`, where four PRs carry a second
  conflicted file.
- The **second** revision stated the strict necessary-condition form — *"no open PR here conflicts
  without it"*. That is **false as of `bf0b18e`**: **PR #93 is a genuine counterexample.** It
  touches `CHANGELOG.md`, `main` has changed `CHANGELOG.md` since its merge base (`94375c1`), and
  the two **merge cleanly** (`git merge-file` rc=0); its only real conflict is on
  `packages/web/src/pages/NotFound.test.tsx`.

**Why #93 escaped is the most useful thing in this document, and it does not weaken the proposal —
it sharpens it.** #93 inserts its entry at **line 11**, immediately under the backfill note: the
*pre-WIC-1543* top anchor. Everything landing on `main` now inserts at **line 23** — the
below-top anchor WIC-1543 introduced (5 of the last 8 changelog-touching commits on `main` land
at line 23 exactly; this PR's own entry and `bf0b18e`'s collided there, which is how this census
came to be run at all). The two populations do not overlap, so the one PR that **ignored the
convention** is the one PR that did not collide.

That is the whole argument in one observation. WIC-1543 did not remove the collision point, it
**relocated** it — from "the top of `[Unreleased]`" to "one heading below the top of
`[Unreleased]`" — and made it just as deterministic for everyone who complies. There is no third
line that would work better, because the property that causes the collision is not *which* line is
shared but *that* one is. A convention whose only observed escapee is its own violator is not a
convention that can be tightened; it is one that has to be replaced by not sharing a line at all.

PR #141 is the case that settles the diagnosis, and it is sharper now than when first written.
It touches `packages/api/src/services/application.service.ts` and `catalog.service.ts`, both of
which `main` also changed since the merge base. **Those two files merge cleanly — at all three
measurements.** At `13cb1e3` it was the control: a PR with genuinely contended source files and
no conflict. At `3396925` it is `CONFLICTING`, and its conflict set is *exactly* `CHANGELOG.md`.
At `bf0b18e`, two days of merges later, that is **still** exactly its conflict set — the two
contended service files have now merged cleanly across three censuses spanning ~5 hours and
~15 changelog merges. The control became an instance without its code changing, and has stayed
one. The repository does not have a merge-conflict problem; it has a changelog problem that
presents as one.

**Scope limit this ADR does not fix.** The non-changelog conflicts are not changelog collisions
and fragments will not remove them. Both `COMPONENT_SPECS.md` cases trace to `38bd487`, which
reformatted 1141/986 lines of that file (694/623 ignoring whitespace) while landing a narrow
heading-level fix, and so collided with every open PR annotating it. Incidental whole-file
reformats riding along with narrow changes are a **distinct** collision source with a distinct
remedy, and are out of scope here. At `bf0b18e` the residual that survives this proposal is
**2 of 10** — #103 on `COMPONENT_SPECS.md` and #93 on `NotFound.test.tsx`. A reader should expect
those two to remain, and should not read "fragments" as a claim about merge conflicts generally.

### Why the two prior fixes did not end it

- **WIC-1157** set `CHANGELOG.md merge=union`. Locally this cut queue conflicts from 6/12 to 2/12.
  But **GitHub does not consult `.gitattributes`** when computing mergeability, so the driver hid
  the conflict from the author and not from the merge button.
- **WIC-1543** moved the insertion anchor below the top `### ` entry. Before it, the anchor was
  branch-point independent — every open PR resolved "the top of `[Unreleased]`" to the same line —
  so collision was *guaranteed by construction*. After it, collision requires two PRs cut from
  near-identical commits. Measured on #174: zero new conflicts across #111, #165 and #166 — a
  real reduction, and a temporary one. #165 and #166 have both conflicted since; #165 stands
  `CONFLICTING` at `3396925` and #166 was repaired twice more the same morning. **The third census
  shows why the reduction could only ever be temporary: compliant PRs now share line 23 the way
  they used to share line 11.** The anchor is branch-point independent again as soon as the top
  entry stops changing between two branch points — which, at ~11 changelog merges a day, is most
  of the time.

Both were real improvements to a shared-line insertion protocol. The measurement above is what
they leave behind: **15% of the changelog-touching open-PR population standing conflicted at any
instant, 21% at the second census and 21% again at the third**, and that population regenerates.
At ~11 changelog-touching merges per day against 40–48 exposed PRs, the residual is not rare — it
is a steady-state occupancy. Two censuses three hours apart returning 21% twice, either side of a
day's merges, is what a steady state looks like; it is not a spike being observed twice.

**The stock understates it, because repaired PRs leave the stock.** Neither this PR (#190) nor
#166 appears in the 13 above, and both went `CONFLICTING` and were repaired in the hours between
the two censuses. The rate is the quantity that matters, and it scales with merge traffic rather
than with where an author aims: any PR cut from the same `main` resolves "below the top entry" to
the same line, so re-anchoring moves the probability and not the mechanism.

The cost also lands unevenly. It concentrates on PRs parked in `REVIEW_REQUIRED` waiting on a
human, which is where every agent-authored PR sits by construction. PR #166 took **nine
collisions in ~28h, four of them inside one 85-minute window**, most on the *re-anchored* line,
with collisions arriving while CI was still running the repair for the one before. A branch can
re-collide faster than its author can push a fix through a ~5-minute CI cycle.

### The union driver's own failures

`merge=union` resolves by concatenation and reports success. Two of its resolutions reached `main`:

- It duplicated three bullets into the WIC-1288 entry, shipping two contradictory descriptions of
  one change (WIC-1561, repaired by #181).
- It ate the blank line at an insertion seam, welding a `### ` heading onto the previous entry's
  last bullet — **even though both parents had that blank line** (WIC-1567, repaired by #185).

Neither showed a conflict marker; neither failed a build. `CLAUDE.md` now carries a `python3`
detector for exactly these, which is a good mitigation for a hazard that should not exist.

## Decision

**Stop sharing the line. One file per change, not one line per change.**

A PR adds `changelog.d/WIC-<id>-<slug>.md` containing only its own entry — byte-identical to the
`### ` block it would have inserted into `CHANGELOG.md` today. Two PRs never edit the same file,
so an insertion collision becomes **structurally impossible** rather than statistically reduced.
This is the standard resolution to this exact failure mode (towncrier, changesets, reno).

### Directory convention

```
changelog.d/
  .gitkeep
  WIC-1516-unit-convention.md
  WIC-1577-changelog-fragments.md
```

- One fragment per PR, named for the card it closes. The card id makes the filename collision-free
  without coordination and keeps attribution after assembly.
- Content is the entry exactly as written today: a `### <Type> — <summary> (<date>)` heading
  followed by its bullets. **No front-matter, no new dependency, no new DSL.** The fragment is
  reviewable as prose in the PR that writes it, and assembly is a concatenation.

### Assembly

A scheduled workflow (`.github/workflows/changelog-assemble.yml`, daily + `workflow_dispatch`)
concatenates `changelog.d/*.md` in sorted order under `## [Unreleased]`, below the backfill note,
deletes the fragments, and **opens a pull request** on a fixed branch `chore/changelog-assembly`.

Opening a PR rather than pushing to `main` is deliberate, and is the load-bearing choice in this
design:

- It needs **no branch-protection bypass**. `main` requires a PR review and the
  `skip-ci-sweep-required` ruleset requires a status check; a bot pushing directly would need a
  grant that does not exist today and that overlaps a governance question already pending with the
  board (`b6d0f6dd`, force-push authority). This design does not touch that question.
- The assembly PR is the **sole writer** of `CHANGELOG.md`. With at most one open at a time it
  cannot conflict with anything, including itself — a re-run updates the existing branch.
- Assembly stays reviewable, and a bad assembly is revertible like any other PR.

Assembly is **not** deferred to release. This repository has zero tags and zero releases, and its
single `[Unreleased]` section has never been cut. "Assemble at release" would mean "never
assemble", which is precisely the failure the board has already logged four times under a different
mechanism (WIC-1394, WIC-1457, WIC-1512, WIC-1552).

### Phased rollout — the cutover is the risky part

Removing `merge=union` on day one would make things **worse**, not better: 47 open PRs currently
carry `CHANGELOG.md` edits, and stripping the driver removes their local auto-resolution while
leaving every one of them still editing the shared file. Sequencing therefore matters.

1. **Introduce** `changelog.d/`, the assembly workflow, and the `CLAUDE.md` rewrite. New PRs write
   fragments. `merge=union` stays. Open PRs are **grandfathered** — they keep their existing
   `CHANGELOG.md` edits and are not asked to convert.
2. **Drain.** The 40 grandfathered PRs merge or close on their own schedule. No forced migration.
3. **Remove the union driver** once no open PR touches `CHANGELOG.md`. At that point
   `.gitattributes` contains nothing but this rule and its comment, so the file is deleted with it.
   The `git merge-file` diagnostic in `CLAUDE.md` stays documented but stops being load-bearing.
4. **Gate (optional, deferred).** A CI check requiring a fragment on PRs touching `packages/**`.
   Deliberately not part of step 1: turning it on against 62 open PRs would fail all of them at
   once, which is the same category of self-inflicted queue damage this ADR exists to end.

## Consequences

### Costs, stated plainly

- **The entry is no longer reviewable in context.** This is the main argument against, and it is
  real — but narrower than it first appears. The fragment *is* in the PR diff and *is* reviewable
  as prose. What is lost is seeing it rendered next to its neighbours: adjacent-entry duplication,
  tone drift, and inconsistent `### ` type prefixes become visible at assembly rather than at
  authoring. The assembly PR is where that review moves; it is not eliminated.
- **Someone must own assembly.** A missed assembly means `[Unreleased]` silently falls behind. The
  liveness metric below exists specifically to make that failure loud, because the board has been
  bitten by the silent version four times.
- **One more directory and one more workflow.** Net machinery is close to flat: the union driver,
  its `.gitattributes` entry, the `git merge-file` diagnostic procedure and the `python3`
  duplicate-bullet detector all stop being required reading.

### Benefits

- Changelog insertion conflicts become structurally impossible, not merely less likely.
- The entire "local git says clean, GitHub says `CONFLICTING`" confusion class disappears, along
  with the two union misbehaviours that reached `main` (WIC-1561, WIC-1567).
- Entries gain per-card attribution before assembly, and the assembly PR gives the changelog a
  single reviewable checkpoint it has never had.

## Alternatives considered

### (a) Keep the status quo and absorb the re-merge cost — **rejected**

Rejected on the measured rate, not on distaste. The steady state is 6 of 40 changelog-touching
open PRs conflicted at any instant, regenerating against ~11 changelog-touching merges per day,
and each repair costs a merge, a push, a full CI cycle and a sweeper dispatch. Eleven cards have
already been spent on it. The status quo is a per-merge tax on the PRs least able to pay it — the
ones parked in `REVIEW_REQUIRED` — and it does not decay as the queue grows; it grows with it.

### (b) Merge queue, or auto-"Update branch" — **available, and rejected on mechanism**

This was checked first, because if it worked it would be far cheaper than anything else here.

**It is available.** Verified 2026-08-27 by creating a repository ruleset carrying a `merge_queue`
rule against this repo — a public repository in a Free organization — which the API accepted
(ruleset `21609897`). The probe was created with `enforcement: "disabled"` scoped to a
non-existent branch, and deleted immediately; `skip-ci-sweep-required` is again the only ruleset.
So availability is **not** the blocker, and the honest reading of AC-2 is that this card does not
reduce to enabling it.

**It does not address this failure.** A merge queue serialises merges and re-tests each PR against
the tip plus the entries ahead of it. That resolves *semantic* conflicts — two changes that each
pass CI alone and fail together. It does not perform conflict resolution. A queued PR that
conflicts textually with the base is **removed from the queue** for the author to fix by hand.
Applied here, a merge queue converts "PR shows `CONFLICTING`, author re-merges" into "PR waits in
the queue, gets ejected, author re-merges" — the same manual repair, arrived at later.

Auto-"Update branch" (`allow_update_branch`, currently `false`) fails for the same reason one step
earlier: the button performs a server-side merge and is simply unavailable when that merge
conflicts. Neither mechanism consults `.gitattributes`, so `merge=union` does not rescue either —
which is the whole finding of WIC-1543, restated.

Both remain worth enabling on their own merits, for the semantic-conflict class they do address.
That is a separate decision and should not be attached to this one.

### (c) A bot that re-merges conflicted PRs automatically — **rejected**

A workflow could, on every push to `main`, check out each conflicted PR, merge `main` locally
(where the union driver *does* apply and would resolve the file), and push. This is technically
sound and would remove the author toil without changing the convention.

Rejected because it makes CI a writer to every contributor branch — a permission grant that
collides with the pending force-push governance question (`b6d0f6dd`) — and because it would run
the union driver unattended at ~11 merges/day, automating the exact resolution that has already
shipped two defects to `main` (WIC-1561, WIC-1567). It treats the symptom at the highest possible
blast radius.

## How we will know whether it worked

Reusing WIC-1543's methodology, which is the right shape: count conflicts introduced across open
PRs by the next N changelog-touching merges.

1. **Primary — conflicts.** Over the next 50 merges to `main`, count open PRs that transition to
   `mergeable: CONFLICTING` with `CHANGELOG.md` in the conflict set, **restricted to PRs authored
   under the fragment convention**. Baseline, today: 6 of 40 (15%) standing conflicted at any
   instant. Target: **0**, and 0 is the structurally predicted value — any non-zero result falsifies
   the central claim of this ADR and should reopen it.

   ```bash
   gh api graphql -f query='{repository(owner:"wickidcool",name:"job-app-management"){
     pullRequests(states:OPEN,first:100){nodes{number mergeable files(first:100){nodes{path}}}}}}' \
     | jq '[.data.repository.pullRequests.nodes[]
            | select(.mergeable=="CONFLICTING")
            | select(.files.nodes[].path=="CHANGELOG.md") | .number] | unique'
   ```

   Per-file attribution — proving the conflict *is* the changelog and not something else — uses the
   `git merge-file` loop quoted in Context, with its positive control.

2. **Secondary — assembly liveness.** No fragment in `changelog.d/` older than 7 days. This is the
   metric for the failure mode this ADR *introduces*, and it is the one to watch hardest, because
   a silently-stalled assembly is exactly the shape of WIC-1394 / WIC-1457 / WIC-1512 / WIC-1552.

3. **Tripwire.** If step 3 of the rollout has not been reached within 60 days — i.e. open PRs are
   still editing `CHANGELOG.md` directly — the drain assumption was wrong and the cutover needs
   revisiting rather than waiting.

## References

- WIC-1577 (this ADR) · WIC-1543 (anchor, and the `.gitattributes`-is-ignored finding) ·
  WIC-1157 (union driver) · WIC-1561, WIC-1567 (union driver defects)
- Re-merge cards: WIC-1303, WIC-1363, WIC-1368, WIC-1375, WIC-1376, WIC-1486, WIC-1513, WIC-1552
- Stale-`[Unreleased]` cards: WIC-1394, WIC-1457, WIC-1512, WIC-1552
- `CLAUDE.md` → "Changelog conventions" (rewritten by the implementing PR)
