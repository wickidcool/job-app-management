# Parked write — WIC-1358 (2026-08-27 ~03:4xZ)

This run woke on `heartbeat_timer`, which 403s `cross_issue_influence_run_context_required`
on `POST /comments` — including my own assigned cards. Two attempts, then stopped per the
execution contract. The `X-Paperclip-Run-Id` header is a **known dead end** and was confirmed
so again here (identical 403 with the header set); see `analytics-program-status` memory and
the 2026-08-27 00:4xZ parked file. Issue creation is the only write path from such a run.

**Post verbatim on the next issue-context wake. Do not rebuild it.**

No status change is pending — the runbook's correct disposition for exit `0` is to leave this
card `todo`, which it already is. This file carries a comment only.

The substantive work of this heartbeat is already durable in version control as **PR #207**
(branch `analytics/wic1358-health-probe-timeout`, commit `8dc93d0`), so nothing is lost if this
comment is delayed.

---

## Comment → WIC-1358 (`e2177ae0-a0a6-4eec-8825-53cd889dcade`)

## Watch result 2026-08-27 03:4xZ — no organic traffic, hold stands

`organic_watch.py` exit **0**. `0 organic / 6 synthetic / 6 lifetime`, newest
`2026-08-26T04:19:39.262Z` (the WIC-967 probe). Zero organic, ever. **WIC-1024 stays `blocked`;
this card stays `todo`.**

Clause (b) also still fails, unchanged and re-measured: `GET https://app.careerpin.app/health`
→ `degraded`, `hyperdrive=false`, `db="Too many subrequests by single Worker invocation."`
Owner unchanged — **WIC-1386**, pending the board decision on **WIC-1473**. Nothing to re-raise.

Normally exit 0 means post nothing. Commenting because the watcher itself had a defect worth
recording.

### The probe was reporting a measured outage as UNKNOWN — PR #207

The first run of this heartbeat printed:

```
COLLECTOR HEALTH: prod DB health UNKNOWN (The read operation timed out)
```

That was **the probe losing a race, not prod being unmeasurable.** The clause-(b) timeout was
30s. While prod is subrequest-exhausted — the entire period this check exists for — `/health`
only answers after the Worker burns its retry budget: **25.6s / 27.2s / 25.6s** measured
back-to-back at 03:4xZ. A ~3s margin, lost intermittently.

This is worth fixing rather than tolerating, because **`UNKNOWN` is indistinguishable from
"never measured"** — and it is the single reading a reviewer could mistake for the outage having
lifted. That is the same false-premise release clause (b) was added to prevent (WIC-1580),
reached through the probe instead of the payload. On this endpoint the slow path *is* the
expected path, so it is now budgeted for: **timeout 30s → 90s**. Three consecutive post-fix runs
report `degraded` where the pre-fix run in this same heartbeat reported `UNKNOWN`.

The PR also names Cloudflare edge 5xx codes (520–526) instead of rendering them
`HTTP 522, unparseable body`. **A 52x is not the WIC-1386 exhaustion:** exhaustion is the Worker
*running* and answering `503` with JSON; a 52x means it never ran. Conflating them misroutes the
reader to the wrong card.

Verdict and exit code are untouched — health stays reporting-only, every fault path still
collapses to `unknown`, so the probe still cannot suppress a real first user. `--selftest`
9 → 14 cases.

### One correction to log, so nobody re-derives it

Mid-investigation I probed **`api.careerpin.app`** and read a sustained `522` as a prod
regression. It is not. **The authoritative endpoint is `app.careerpin.app/health`** (single
Worker serves both the SPA and `/api/*`; the SPA calls same-origin `/api`, per
`VITE_API_BASE_URL` defaulting to `/api`). `api.careerpin.app` has **zero references anywhere in
the repo** — a dangling DNS record, not a product surface. Its `522` is not evidence of anything
and should not be escalated. Flagging it only because it is an easy and convincing wrong turn to
take twice.

### Remaining

- Watch continues each heartbeat; unchanged procedure.
- PR #207 needs review (docs/ops script only — no product code, no wire values).
