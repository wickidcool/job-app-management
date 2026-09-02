## 2026-09-01 checkpoint — the watcher was blind, and that is the entry. Hold stands on both clauses.

Breaking this card's "silent on no-op" rule deliberately, as on 08-29 and 08-30. The organic reading is unchanged for the third consecutive day — but the **detector that produces it had stopped working**, and a watcher that cannot fire is worth a file even when its answer is the same.

Measured 2026-09-01 ~01:3x–02:0xZ. Run from the **real checkout**, working tree clean, branch `fix/wic1358-async-query-fallback` cut from `origin/main` at `28e20cd`.

> Checkpoints now live **in the repo**. The 08-29 and 08-30 checkpoints sit only in the workspace-root `docs/` tree, which is a stale Aug-19-era orphan copy outside version control — the "two-file scratch copy" trap. Do not read or extend that tree.

### The finding: `organic_watch.py` returned exit 1 on every run

Not "no traffic" (exit 0), not "candidate" (exit 10) — **exit 1, "the check itself failed"**, four times in a row:

```
CHECK FAILED (not evidence of anything): The read operation timed out
CHECK FAILED (not evidence of anything): HTTP Error 504: Gateway Timeout
```

Exit 1 is the fail-safe code and it was **honest** — the watcher correctly refused to report an absence it could not verify. But it is also exactly what this watcher would have returned **on the day a real first user arrived**. The detector could not fire in either direction, and it is the sole trigger for releasing the WIC-1024 hold. Fail-safe is not the same as armed.

### Cause: a 60× query budget difference, isolated in four probes

Not auth, not the network, not our predicate. Each probe narrows it:

| probe | result |
|---|---|
| `GET /api/projects/551963/` | **200 in 0.32s** — key and project fine |
| `SELECT 1` (sync) | **200 in 0.32s** — HogQL endpoint up |
| `SELECT count() FROM events` (sync) | **504 at 19.6s** |
| same query, async (`refresh: force_async`) | **200**, `[[6, '2026-08-26T04:19:39.262Z']]` |

A bare `count()` times out on a project holding **six lifetime events**. The mechanism is in the `clickhouse` field each response echoes back:

```
sync    max_execution_time=10
async   max_execution_time=600
```

The events-table read no longer finishes inside the sync leg's 10s budget. The legacy REST path (`/events/?limit=20`) **503s** as well, so two independent read surfaces are degraded — but the async leg answers correctly.

### Clause (a) — first organic event: still zero, and now re-armed

Via the async leg, then via the fixed watcher:

```
organic_events   = 0        synthetic_events = 6
organic_people   = 0        lifetime_events  = 6
organic_newest   = (none)   lifetime_newest  = 2026-08-26T04:19:39.262000Z
```

Exact complement, **zero residue, zero organic**. Newest is still the WIC-967 DevOps probe. **No drift in 72h** — identical count and identical newest-timestamp to both the 08-29 and 08-30 readings.

### Clause (b) — root `GET /health`: still degraded

```
{"status":"degraded","hyperdrive":false,
 "db":"Too many subrequests by single Worker invocation..."}   [HTTP 503]
```

Probed directly against `https://app.careerpin.app/health`, independently of the watcher. The false-green control reproduces exactly: bare `careerpin.app/health` returns **200 + SPA HTML**. Discriminate by **body**, never status code.

### The fix (PR pending) — narrow async fallback + submit retry

`run()` was the single choke point for both PostHog call sites, so the fallback went inside it: sync first (0.32s when it works), async only on faults meaning *"no answer, but the question was fine"*.

- **Narrow on purpose.** Only `408/502/503/504` and socket timeouts hand off. `401`, malformed-HogQL `400` and ClickHouse `500` propagate untouched — each reproduces identically on the async leg, so retrying would burn the 240s budget before failing the same way.
- **The async *submit* is itself flaky, and its shape decided the remedy.** Three consecutive submits of one query: **40s / 40s / 0.27s**. A good submit is sub-second; a bad one hangs to the timeout and never recovers — a dead connection, not a slow queue. So: short timeout, try again. Without this the fallback fails closed at its one point of failure, which was **observed live** before the retry existed.
- **Sync timeout 60s → 20s.** Its server budget is 10s, so a sync call unanswered at 20s is hung in the gateway and will never return; the old 60s merely spent time the async leg needed.

**Verification.** Selftest 58/58 → **70/70**. The 12 new cases were run against the **pre-fix dispatch** as a control: the 6 retryable cases fail there, the 6 propagation cases pass — so they pin the new behaviour rather than restating the code. End-to-end, four consecutive live runs against the degraded backend all returned an answer and exit `0`; **run 1 exercised the entire chain** (sync `504` → fallback → submit timeout → retry → correct result, 72s), runs 2–4 took the fast sync path. The fault is intermittent, so both paths matter.

Changelog anchor derived, not inherited: the thematically obvious heading (`synthetic-exclusion rewriter`) carries **5** open PRs, second-most contended in the file. Landed on an uncontended one instead, padded both edges, verified pure addition (13/0), union simulation clean on misfile/duplicate/weld, and **0 conflicts added** across all 49 open `main`-based PRs (15 before, 15 after).

### Control-plane: unbound run, writes unavailable — as designed

`invocationSource: timer`, `contextSnapshot` carries no `issueId` and no `taskId`, so the run is **unbound** and every issue is cross-issue to it, including this one. Comment and PATCH return `403 cross_issue_influence_run_context_required`. Predicted before any API call by `PAPERCLIP_SCRATCH_DIR` = `paperclip-run-unassigned-…`. This is working as designed (WIC-1817), not a defect — do not file it, and do not retry with `X-Paperclip-Run-Id`, which was already set correctly.

**Consequence:** the evidence lives here and in the PR rather than on the cards. Nothing is lost — the sole gate remains a human decision on `ba8bf467`.

### Disposition

- **WIC-1358 stays `todo`** — armed and waiting on traffic, which is its designed steady state. It is *genuinely* armed again as of this checkpoint; for some unknown window before it, it was not.
- **WIC-1024 stays `blocked`.** Unblock owner: the **board**, action: answer ask `ba8bf467` on WIC-1473 (`explicit` provenance, honestly `human_only`, ~26h old; 72h re-validation falls due **~2026-09-02T00:01Z** — not before). Second clause: prod root `GET /health` returning `ok`.
- **Watch PostHog's sync leg.** If it stays degraded the watcher now runs ~72s per invocation instead of ~4s. That is acceptable for a heartbeat-cadence detector and must not be "optimised" by removing the fallback.
- The next entry here is still intended to be the organic-event trigger, carrying event name, timestamp and `distinct_id`/`person_id`.

---

## 2026-09-01 ~23:2x–23:3xZ, second reading — the entry is a **correction to the section above**: its unblock pointer was already dead when it was written down

Breaking the "silent on no-op" rule again, and for the narrower of the two permitted reasons. The organic reading is unchanged for a fourth consecutive time and carries no news. What earns the file is that the **disposition block above sends the next reader to an ask that can never be answered, on a card that is closed** — and it would have sent them there on a scheduled date, with the authority of a checkpoint.

Run from the real checkout, working tree clean, branch cut from `origin/main` at `7f8646d` — the first run of the merged async fallback (PR #317) from `main` rather than from its own feature branch.

### The correction

The section above closes with:

> Unblock owner: the **board**, action: answer ask `ba8bf467` on WIC-1473 (`explicit` provenance, honestly `human_only`, ~26h old; 72h re-validation falls due **~2026-09-02T00:01Z** — not before).

Every operative clause of that is now false, and two of them were already false-in-waiting:

| claim, 02:10Z | measured 23:2xZ |
| --- | --- |
| ask `ba8bf467` is pending | **`expired`** — it died unanswered, the modal fate of a `human_only` ask |
| on WIC-1473 | WIC-1473 is **closed `done`** (design decided: ADR-007 option 1) |
| re-validate it at ~2026-09-02T00:01Z | **void** — there is no re-validation of an expired ask, and no amend route |

So the scheduled action was not merely stale, it was **unperformable**, and its due date fell ~38 minutes after this reading — close enough that the next heartbeat would have tried it. DECIDED ≠ DONE cuts both ways: naming a closed card as the unblock owner sends the reader somewhere that says "resolved" about a P1 that is still down.

**The live gate is board approval `d61d200b` on WIC-1386** (`pending`, filed 2026-09-01T02:07:24Z, ~21.3h old). It is the only thing the chain waits on. Do not withdraw it, do not re-file it, and do not re-diagnose the outage behind it — all three were considered and settled today on WIC-1944 (closed `done`), where DevOps judged the compound-approval finding and de-compounded the decision **in prose** on WIC-1386 rather than splitting the artifact, on the reasoning that `revision_requested` is 0/96 unexercised and not worth introducing on a live-P1 path.

### The tell: the code was current, the prose was stale

The watcher's own output already names the right owner —

```
Unblock owner: WIC-1386 (pending board approval -- needs a Cloudflare credential
to provision the prod Hyperdrive config; the design decision itself is already
made and closed on WIC-1473, ADR-007 option 1).
```

— because that string is built next to the check that produces it. The disposition block above is hand-written prose in a document nothing re-runs. **A generated pointer decays visibly; a hand-written one decays silently and keeps its authority.** Where a checkpoint and its own tool disagree about who is blocking, the tool is the one that got re-executed.

### Clause (a) — first organic event: still zero, fourth consecutive identical reading

```
organic_events   = 0        synthetic_events = 6
organic_people   = 0        lifetime_events  = 6
organic_newest   = (none)   lifetime_newest  = 2026-08-26T04:19:39.262000Z
```

Exit `0`, 15.0s. Exact complement, zero residue. Newest is still the WIC-967 DevOps probe — **no drift in 96h**, identical count and identical newest-timestamp across the 08-29, 08-30, 09-01T02:0xZ and this reading.

Read it with the reachability split, not as clean demand evidence: only `resume_upload_started` and `resume_upload_validation_failed` are outage-immune (browser → PostHog, no Worker in path). Five are outage-blocked and `export_viewed` is unreachable dead code. **This zero is a demand reading for 2 events and a restatement of the outage for the other 7.**

### Clause (b) — root `GET /health`: still degraded

```
HTTP 503  {"status":"degraded","hyperdrive":false,
           "db":"Too many subrequests by single Worker invocation. ..."}
```

Probed directly against `https://app.careerpin.app/health` at 23:23Z, independently of the watcher. `hyperdrive:false` remains **runtime** proof the prod binding is still absent — better evidence than reading `wrangler.jsonc`, because it is what the isolate actually holds.

### PostHog's sync leg has recovered — and that is not a reason to drop the fallback

The 09-01T01:3xZ entry recorded `SELECT count() FROM events` **504-ing at 19.6s** against a six-event project, which is what forced the async path and the ~72s runtime. Re-measured directly just now, all three probes on the **sync** leg:

| query | 01:3xZ | 23:3xZ |
| --- | --- | --- |
| `SELECT 1` | 200, 0.32s | 200, **0.37s** |
| `SELECT count() FROM events` | **504 at 19.6s** | 200, **0.86s** |
| `SELECT max(timestamp) FROM events` | (not probed) | 200, **0.79s** |

Server budget still echoes `max_execution_time=10` on the sync leg, unchanged — so the budget did not move; the events-table read got fast again. The async fallback **did not fire today**, and the whole run cost 15.0s instead of 72s.

⚠️ **Do not read this as evidence the fallback is unnecessary.** The fault was intermittent when it was present — within the 09-01 session three consecutive async *submits* of one query took 40s / 40s / 0.27s — and it is now simply absent. Today's fast path exercises the sync leg only, which is precisely the leg that was working before too. The fallback is insurance against a fault that has already recurred once and left no mechanism behind that would prevent it recurring again. The 70/70 → 94/94 selftest (PR #323) is what pins it; the wall-clock is not.

### Control-plane: unbound run, writes unavailable — as designed, and predicted before the first API call

`invocationSource: timer`, `contextSnapshot` carries neither `issueId` nor `taskId`, so the run is **unbound** and every card is cross-issue to it — including the two I am assigned. `PAPERCLIP_SCRATCH_DIR` = `paperclip-run-unassigned-…` predicted it before any request was sent. Comment and PATCH are unavailable (WIC-1817, working as designed); issue-create and interaction-create remain open, and neither is warranted here — there is no question to ask that is not already sitting in `d61d200b`.

**Consequence:** this file is the durable channel for the reading, as it was at 02:10Z. Nothing is lost — the sole gate remains one human decision.

### Disposition

- **WIC-1358 stays `todo`** — armed, verified armed by execution rather than by inspection, waiting on traffic. That is its designed steady state.
- **WIC-1024 stays `blocked`** on both clauses. **Unblock owner: the board. Action: decide approval `d61d200b` on WIC-1386.** Second clause: prod root `GET /health` returning `ok` — which that same approval is what unblocks.
- **No re-validation is scheduled**, and the ~2026-09-02T00:01Z date above is withdrawn. Approvals are not interactions: `d61d200b` sits in a channel that decides 88.5% of what it receives and it is younger than 16 of the 85 already-decided approvals were at decision time. It is not stuck, and there is no re-ping that would help.
- **WIC-1024 carries no blocker edges and no recovery action**, which normally means nothing can wake it. It is *not* stranded here: WIC-1358 is `todo`, assigned to the same agent, and its entire purpose is to re-raise WIC-1024. The wake path is the watcher, not an edge.
- The next entry here is still intended to be the organic-event trigger, carrying event name, timestamp and `distinct_id`/`person_id`.
