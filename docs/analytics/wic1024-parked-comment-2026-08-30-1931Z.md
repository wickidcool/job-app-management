# WIC-1024 parked comment — 2026-08-30 ~19:31Z

**Parked, not posted.** `POST /api/issues/{id}/comments` failed twice on WIC-1024 from an unbound
timer run. Two consecutive failures of the same control-plane write, so no further retries this
heartbeat. Same parking convention as `wic1358-parked-comment-2026-08-30-0655Z.md`.

## New this run: the 409 masks the 403, on a *blocked* card

Worth recording because it is a **second, distinct trigger** for a masking effect previously only
seen on `in_review` cards. The two attempts were not the same call:

| # | payload | result |
|---|---------|--------|
| 1 | `{body, resume: true}` | **`409 Issue follow-up blocked by unresolved blockers`**, `unresolvedBlockerIssueIds: [fa2ff896…]` (= **WIC-1547**) |
| 2 | `{body}` — `resume` dropped | **`403 cross_issue_influence_run_context_required`** |

The blocker check runs **before** the cross-issue run-context guard, so on a `blocked` card carrying
an unresolved blocker, `resume: true` returns a `409` that completely hides the underlying `403`.
An agent that reads that `409` as "I am bound, I just need to clear the blocker" will draw exactly
the wrong conclusion about its own write capability. Generalised rule: **a `409` from
`POST /comments` is never evidence that the run is bound.** Previously recorded for `resume: true`
on an `in_review` card; this is the `blocked` + `blockedByIssueIds` path.

`resume: true` was wrong here regardless — it is for restarting work on a *completed* issue, and
WIC-1024 is `blocked`, not `done`. Dropping it was a corrected call, not a blind retry.

Per the standing fleet rule the `403` was **not** retried with `X-Paperclip-Run-Id`. The header is
already set correctly; a timer run fails inside `observeCrossIssueInfluence` because its
`contextSnapshot` carries no source issue, so re-sending the header cannot help. Confirmed unbound
in advance from `GET /api/heartbeat-runs/$PAPERCLIP_RUN_ID`: `invocationSource: timer`,
`contextSnapshot` keys carry neither `issueId` nor `taskId`.

---

**Heartbeat re-check 2026-08-30 — hold STANDS, both release clauses still unmet.**

Ran `docs/analytics/organic_watch.py` from the real repo checkout on `main` (not a two-file scratch
copy), exit code **0**:

- **Clause (a) — first organic event: UNMET.** `organic_events=0`, `organic_people=0`. Lifetime
  **6** events, all synthetic (registry: 4 probes / 4 distinct_id / 6 uuid / 3 session_id exclusion
  keys), newest `2026-08-26T04:19:39.262Z` — no new traffic of any kind in 4 days.
- **Clause (b) — prod DB healthy: UNMET.** Unauthenticated `GET https://app.careerpin.app/health`
  (the app host — *not* the bare marketing domain, which false-greens with SPA HTML) returned
  **503** `{"status":"degraded","hyperdrive":false,"db":"Too many subrequests by single Worker
  invocation"}`. Same subrequest-exhaustion signature as WIC-1386.

**Caveat, so the zero is not over-read:** only 2 of the 9 taxonomy events are outage-immune
(`resume_upload_started`, `resume_upload_validation_failed` — browser-direct, no Worker in the
path). 5 are outage-blocked and `export_viewed` is unreachable dead code. This zero is therefore a
demand reading for **two** events and a restatement of the outage for the rest. The detector still
trips on a real first user. Per-event split: `event-reachability-matrix.md`.

## Chain re-verified this run — the gate is a human decision, and it has not moved

| item | state | note |
|---|---|---|
| **WIC-1547** | `blocked`, DevOps `288abc97` | **direct blocker of this card** (`fa2ff896`); PostHog insight/dashboard scope grant, gated on `human_only` ask `9c0fbf89` |
| WIC-1386 | `blocked` | P1 subrequest exhaustion — this *is* clause (b) |
| PR #148 | **OPEN**, `MERGEABLE`, head `a3e833d0` | the P1 fix. `mergeStateStatus=BLOCKED` is the known shared-identity artefact (`alwick` both authors and reviews), **not** a review gate |
| WIC-1473 ask `ba8bf467` | **pending**, `human_only`, provenance `explicit` | third attempt; the prior two died `cancelled` (`106500e3`) and `expired` (`7accee50`) |

`ba8bf467` re-reads as sound, current and honestly `human_only` — **not** to be withdrawn or
down-scoped. It needs Allan. Note both dead predecessors carry provenance
`legacy_inherited_restriction` (written as `board_only`); only the live one was labelled
deliberately.

## Disposition

`blocked` remains the truthful status, with named unblock owners — DevOps `288abc97` on WIC-1547,
and the board on WIC-1473. No agent-actionable step remains on this card. WIC-1358 (`todo`) stays
the live watcher path that will re-raise it.

**For the next agent with a bound run:** post the section from "Heartbeat re-check" down to
"Disposition" verbatim as a WIC-1024 comment, **without** `resume: true`.
