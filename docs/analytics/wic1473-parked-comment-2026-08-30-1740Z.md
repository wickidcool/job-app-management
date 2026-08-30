# WIC-1473 parked comment — 2026-08-30 ~17:40Z

**Parked, not posted.** `POST /api/issues/219aa371.../comments` returned `409 Issue is not
resumable through comment follow-up intent` with `resume:true` (the card is `in_review`, so the
resume intent does not apply), then `403 cross_issue_influence_run_context_required` without it.
Two failures, so no further retries this heartbeat. Run scratch is `paperclip-run-unassigned-*`
— an unbound timer run, so every write is cross-issue by construction. Per fleet guidance the
`X-Paperclip-Run-Id` retry the error text recommends cannot work and was not attempted.

Ordering detail worth keeping: the **resumable check runs BEFORE the cross-issue guard**, so a
`409` here does not mean you are bound — drop `resume` and you get the real `403`.

Routed instead as a board card to the Architect (owner of WIC-1473), who has bound runs.

---

**Independent re-validation of the pending board ask `ba8bf467` (ask-hygiene §4) — premise HOLDS, answer it as written.** Checked by the Data Analyst at 2026-08-30 ~17:40Z; WIC-1024/WIC-1358 are held on this card's clause (b), so I re-measured rather than waited.

**1. Head drift — disclosed, and immaterial.** The ask was filed `2026-08-30T00:01:41Z`; PR #148's head then advanced to `a3e833d0` at `04:44:15Z`, **4h43m after the ask**. A `request_board_approval`/ask records no head SHA, so nothing would have flagged this. I diffed it: `a3e833d0` touches **one file**, `docs/architecture/adr/ADR-007-workers-subrequest-budget.md` (+149/-42), and **no runtime code**. Per approval-head-drift rule 2 that is a docs/posture delta — the standing ask stands, no withdraw-and-recreate needed. This comment is the drift record that rule requires.

Its content also *corroborates* the ask rather than moving it: the commit withdraws the IPv6/repoint diagnosis, which is exactly what the ask's `prod-infra` question already tells you ("both 'repoint' options are VOID"). Ask and branch agree.

**2. "MERGEABLE and green" — confirmed by ground truth, not by the flag.** Per changelog-mergeability, the `mergeable` field is a sticky-dirty cache and is not sufficient alone. Two independent signals:

- **GitHub's own merge commit** `refs/pull/148/merge` = `92cf1a3e`, a clean **2-parent** commit with **zero conflict markers**, computed `17:25:02Z` — 11 minutes before I looked, so not stale. Its base parent is `e49a1285`, which **is exactly the current `origin/main` tip** (0 commits since). So #148 merges clean *at today's base*, not at some older one.
- **CI is green on the current head**: `Lint & Test` SUCCESS, `E2E Tests` SUCCESS, `Deploy Preview` SUCCESS (04:45–04:47Z). `Deploy Production` SKIPPED is correct for a PR. The one `CANCELLED` entry is the repo-wide *Sweep open PRs* job, not a gate on #148. This is also not the CONFLICTING false-green trap: `E2E` and `Deploy Preview` are `pull_request` workflows and they **ran**, which only happens when the merge ref builds.

`mergeStateStatus: BLOCKED` is the known identity artifact in this repo (every agent pushes as `alwick`, so `reviewDecision` sticks at `REVIEW_REQUIRED`) — it is not an open review gate, and `--admin` squash-merge is the repo norm here.

**3. `human_only` is the honest label.** Both questions need a human: an `--admin` merge authorization and a paid-Cloudflare-feature spend decision. No agent can supply either, and this ask should NOT be down-scoped to `not_creator`. Note its two predecessors on this card both died unanswered (one `cancelled`, one `expired`) — that is the 76% ask-death rate, and this is the third attempt at the same decision.

**4. Clause (b) status, unchanged.** Root `GET /health` on `app.careerpin.app` returns **503 `degraded`, `hyperdrive:false`, "Too many subrequests by single Worker invocation"** as of 17:37Z. Watcher `organic_watch.py` exit 0, lifetime=6 events all synthetic, newest `2026-08-26T04:19:39Z`. The WIC-1024 hold stands on both clauses; I am not asking for anything here and this changes no status.

**Net: nothing about this ask has decayed. It is accurate, current, and squarely human-only — it needs Allan, not more measurement.**
