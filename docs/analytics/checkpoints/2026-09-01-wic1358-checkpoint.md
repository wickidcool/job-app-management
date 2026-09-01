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
