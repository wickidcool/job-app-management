# Fleet health: the PR merge backlog, 2026-08-30 05:40Z

Measured by the Data Analyst from `gh` + the Paperclip issues API. All figures re-derivable
with the commands in "Method" below.

## Headline

**78 open PRs. 61 are `MERGEABLE` with every CI check green. Median open age 3.4 days.
Yet the median PR that *does* merge merges 14 minutes after it is opened.**

Merge behaviour is bimodal, and the two modes are "merged by its author in the run that
created it" and "never merged at all". There is no queue that drains: 57% of the last 120
merges happened inside one hour, while 54 of the 78 open PRs are already older than 72h.
A PR that survives its authoring run is, empirically, orphaned.

### Time-to-merge, last 120 merged PRs

| bucket | n | share |
|---|---|---|
| <1h | 68 | 57% |
| 1-6h | 9 | 8% |
| 6-24h | 17 | 14% |
| 1-3d | 8 | 7% |
| >3d | 18 | 15% |

**median time-to-merge = 0.24 h (14 min).**

### Open backlog (n=78, 3 drafts)

- median age **3.4 d**, p90 **4.3 d**, oldest **10.8 d**
- older than 72h: **54 of 78**

| mergeable | mergeStateStatus | n |
|---|---|---|
| CONFLICTING | DIRTY | 17 |
| MERGEABLE | BLOCKED | 37 |
| MERGEABLE | CLEAN | 23 |
| MERGEABLE | UNSTABLE | 1 |

## Nothing machine-side is gating these

`mergeStateStatus` splits the mergeable set 37 `BLOCKED` / 23 `CLEAN`, and the split is
**not** about CI. Probed four PRs directly:

| PR | mergeStateStatus | reviewDecision | checks |
|---|---|---|---|
| `#237` | BLOCKED | `REVIEW_REQUIRED` | all SUCCESS |
| `#148` | BLOCKED | `REVIEW_REQUIRED` | all SUCCESS (1 sweep CANCELLED) |
| `#220` | CLEAN | *(none)* | all SUCCESS |
| `#117` | CLEAN | *(none)* | all SUCCESS |

`BLOCKED` here means only that a reviewer was requested, on a repo where every agent pushes
as `alwick` and so can never satisfy a review. `CLEAN` means no reviewer was requested.
**Both cohorts have identical, fully green CI.** The constraint is entirely the merge
action, not the machine.

*(Correction to my own prior note: I had recorded `mergeStateStatus` as **permanently**
`BLOCKED` in this repo. It is not — 23 open PRs are `CLEAN`. The identity artefact is real
but it only applies once a reviewer has been requested.)*

## Sitting is not free — the backlog rots

17 open PRs have already decayed `MERGEABLE` → `CONFLICTING` (median age 3.5d vs 3.2d for
those still mergeable). That work now needs a rebase before it can ever land, and the two
board asks audited under `board-ask-hygiene` §4 died of exactly this decay.

## The part that corrupts the record: 6 cards are `done` on PRs that never merged

Every one of these cards was closed **after** its PR opened, and the PR is still open today:

| PR | opened | card | card status | PR state now |
|---|---|---|---|---|
| `#143` | 08-26 07:59 | WIC-1382 | done | MERGEABLE |
| `#158` | 08-26 12:40 | WIC-1449 | done | MERGEABLE |
| `#165` | 08-26 17:17 | WIC-1514 | done | **CONFLICTING** |
| `#171` | 08-26 18:17 | WIC-1530 | done | **CONFLICTING** |
| `#173` | 08-26 18:34 | WIC-1531 | done | MERGEABLE |
| `#188` | 08-27 00:14 | WIC-1574 | done | **CONFLICTING** |

This is the WIC-1700 / PR `#148` failure — *a card going `done` is not the action
happening* — shown to be systemic rather than a one-off. Half of them have already rotted.
The board's view of what shipped is wrong for at least these six items.

## Recommendation (triage policy, not a mass merge)

1. **Cohort A — 21 `MERGEABLE`+`CLEAN`, all green.** Land or close, oldest first. These are
   the cheapest: nothing is pending on them.
2. **Cohort B — 37 `MERGEABLE`+`BLOCKED`.** The review request can never be satisfied by an
   agent (identity artefact). Per repo norm these merge with `--admin`. Either merge them or
   stop requesting reviewers that cannot exist.
3. **Cohort C — 17 `CONFLICTING`.** Rebase or close. Do not leave them; they only get worse.
4. **Reopen the 6 cards above**, or merge their PRs, so card status and `main` agree again.
5. **Carve-out, important:** do **not** sweep `#148` into any batch merge. The board is
   being asked to authorize that exact merge under pending ask `ba8bf467` on WIC-1473, and
   its head has already moved once (`7c0c014` → `a3e833d`). Merging it outside that ask
   would execute a decision the board is still holding.

## Method

```
gh pr list --state open   --limit 100 --json number,createdAt,mergeable,mergeStateStatus,isDraft,title
gh pr list --state merged --limit 120 --json number,createdAt,mergedAt,title
gh pr view <n> --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
GET /api/companies/{companyId}/issues?limit=500     # card status join, on WIC-ids in PR titles
```

Caveats stated plainly: the card join matches `WIC-\d+` in **PR titles only** (75 of 78 open
PRs name a card), so cards referenced only in a PR body are not counted — 6 is a floor, not
a ceiling. `gh pr list` defaults to 30 results; the 78 figure needs `--limit 100`, and
reading the default is how this backlog stayed invisible.

## Appendix — actionable lists

#### A. MERGEABLE + CLEAN + not draft — n=21 (no reviewer requested, all checks green)

- `#117` 4.3d — copy(web): fit-tier blurbs read as tiles, not spec lines (WIC-1318)
- `#118` 4.3d — fix(web): make VERDICT_TIERS exhaustive over FitTier, not a subset of it
- `#129` 4.1d — test(api): key the onboarding stubDb by table, not call position (WIC-13
- `#130` 4.1d — test(api): assert the id half of the merge tenancy predicates (WIC-1378)
- `#139` 3.9d — test(api): pin listDiffs' tenancy predicate, both halves (WIC-1407)
- `#144` 3.9d — test(api): pin the six remaining catalog list* tenancy predicates (WIC-1
- `#163` 3.7d — fix(projects): require an owner to resolve a project by slug (WIC-1434)
- `#167` 3.5d — fix(web): StarEntryPicker read a [0,1] relevance score as 0-100 (WIC-152
- `#173` 3.5d — test(web): assert every route has an inbound link, not just the converse
- `#176` 3.4d — fix(analytics): give the WIC-1547 scope grant an acceptance test that ca
- `#191` 3.2d — test(web): pin the partial-view notice and the collection metadata behin
- `#201` 3.1d — test(web): strip comments before crediting link sites in route audit (WI
- `#210` 3.1d — fix(auth,projects): no anonymous authenticated caller — sub-less JWT rej
- `#215` 2.9d — test(web): close the parenthetical hole in upload-limit-drift clause sco
- `#220` 0.6d — fix(api): require an owner on the 19 fail-open catalog/STAR sites (WIC-1
- `#222` 0.6d — Give the product one definition of "stale" (WIC-1479)
- `#227` 0.6d — feat(api): add a [NOWNER] check for owner-absent writes to the AC-T0 gua
- `#239` 0.3d — test(api): cursor-coverage guard reads every export form, not just `expo
- `#248` 0.2d — docs(WIC-1731): rule that salary filtering is dropped, and say why
- `#249` 0.2d — refactor(api)!: rename the interview-prep relevance score to relevanceSc
- `#252` 0.0d — feat(web): announce create-success on ProjectsList, via a shared announc

#### C. CONFLICTING — n=17 (rotted from sitting; needs rebase or close)

- `#92` 10.8d — design(web): drop the secondary "Go back" action from the 404 page (WIC-
- `#93` 10.8d — fix(web): stop the nav marking a nonexistent route as the current page (
- `#115` 4.3d — fix(web): give post-delete focus a target that survives the delete (WIC-
- `#123` 4.1d — fix(api)!: catalog list routes return the documented envelope, not a bar
- `#141` 3.9d — fix(catalog): scope extraction and auto-apply to the document owner (WIC
- `#149` 3.9d — fix(projects): namespace project files by owner in storage (WIC-1433)
- `#154` 3.7d — ci(analytics): gate console pack regeneration from insight-payloads.json
- `#160` 3.7d — fix(WIC-1478): compute Dashboard attention counts server-side
- `#165` 3.5d — fix(WIC-1514): the Dashboard "Response" stat could only ever read 0% or 
- `#171` 3.5d — fix(web): give the outreach composer an entry point (WIC-1530)
- `#179` 3.3d — test(web): pin the by-fit-tier empty-state copy against the WIC-1297 §4 
- `#180` 3.3d — fix(web): the optimistic Kanban status patch never ran (WIC-1497)
- `#188` 3.2d — test(api): execute the dashboard attention aggregates, don't just descri
- `#208` 3.1d — test(web): CoverLetterNew's outline tests could not see a heading skip (
- `#211` 3.0d — fix(web): the applications filter panel went stale on a shortcut and dro
- `#213` 3.0d — fix(WIC-1495): clear every app-owned localStorage key on sign-out; stop 
- `#217` 0.7d — fix(web): wire the application workflow checklist to real completion sta
