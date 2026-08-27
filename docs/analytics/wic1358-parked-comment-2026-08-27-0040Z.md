# Parked writes — WIC-1358 / WIC-1024 (2026-08-27 ~00:4xZ)

> **LANDED 2026-08-27 ~00:5xZ — do not post these again.** All three writes went through on the
> first issue-bound wake: §1 comment `8746e5a7`, §2 description `PATCH` HTTP 200 (6546 → 8272 chars,
> read back byte-identical), §3 comment `c2cc7d64` on WIC-1024. The 403 was a heartbeat-timer
> artefact, not a standing block. Clause (b) as landed is stronger than the version below — it
> requires `"db":"ok"` as well as `"status":"ok"`; see the WIC-1580 note under §2. Kept as the record
> of what was posted and why.

This run woke on `heartbeat_timer`, which 403s `cross_issue_influence_run_context_required`
on both `POST /comments` and `PATCH /issues/{id}` — including my own assigned cards. One
attempt was made, no retry (the `X-Paperclip-Run-Id` header is a known dead end; see
`analytics-program-status` memory). Issue creation is the only write path from such a run.

**Post these verbatim on the next issue-context wake. Do not rebuild them.**

---

## 1. Comment → WIC-1358 (`e2177ae0-a0a6-4eec-8825-53cd889dcade`)

## Watch ran: **0 organic**, hold stands — but the hold now has a *second* clause, and it is measured

`organic_watch.py` exit `0`. `lifetime=6`, all synthetic, newest `2026-08-26T04:19:39.262Z`
(the WIC-967 DevOps probe). Zero organic, ever. **No re-raise of WIC-1024.**

This card says exit `0` means post no comment. I am overriding that deliberately, once: this
heartbeat found that **a statement in this card's own description is wrong**, and left
uncorrected it would eventually release the WIC-1024 hold on a false premise. That is the
misinformation-decay failure the fleet ask-hygiene rule exists to prevent.

### What is wrong

The description asserts:

> Zero organic events is a **traffic/demand** question, not an engineering defect — there is
> nothing to fix and nothing to deploy.

Production is currently broken for every logged-in user, and this card did not know it.

### Measured 2026-08-27, free and unauthenticated

Root `GET /health` — *not* `/api/health`, which is auth-guarded and cannot see this. Per the
Architect's correction on WIC-1386, that is the right path to watch:

```
GET https://app.careerpin.app/health            -> 503
GET https://jobtrail.al-23f.workers.dev/health  -> 503
{"status":"degraded","hyperdrive":false,
 "db":"Too many subrequests by single Worker invocation. ..."}
```

WIC-1386 is not fixed. PR #148 shipped the subrequest-budget fix but **by design does not
restore DB reachability** — prod has no `HYPERDRIVE` binding and `db.<ref>.supabase.co` is
IPv6-only. That is the pending board decision on **WIC-1473**.

### Why this does *not* invalidate the watcher — and where it does

| leg | path | under the outage |
|---|---|---|
| **client** — `resume_upload_started`, `_validation_failed`, `_cta_clicked` | browser → `us.i.posthog.com` | **unaffected** |
| **server** — `_submitted`, `_completed`, `_failed` | Worker (`resume.service.ts`) | broken |

- `resume_upload_submitted` fires **before** `getDb()` (`resume.service.ts:450`) — it survives.
- `resume_upload_completed` sits **after** the DB writes (`:596`) — structurally unreachable.
  The catch path emits `_failed` (`:759`) instead.

So the client capture leg is independent of the broken Worker DB, and **"0 organic" is still a
valid reading of top-of-funnel arrivals** — that much of this card holds. What does not hold is
the release condition:

> **A first organic visitor is necessary but no longer sufficient to release WIC-1024.**

While the DB is down the server funnel can only ever record 100% failure. Building dashboards
A/B/C on that would render the completion and timing insights empty, and C1–C3 key on
`person_id` across authenticated sessions that currently cannot happen.

### Shipped, so the next heartbeat cannot make this mistake

**PR #192** — `organic_watch.py` now probes collector health itself and prints a
`COLLECTOR HEALTH:` line on both the quiet and candidate paths, and on the candidate path says
explicitly that the second clause is unmet.

Reporting only: exit codes (`0`/`10`/`1`) unchanged, every health fault path collapses to
`unknown`, so a failed probe can never suppress a real first user. Verified against an
unresolvable host — still exit `0`, verdict intact.

One trap found en route: Cloudflare answers urllib's default `Python-urllib/3.x` with a **403
bot challenge**, indistinguishable from a degraded app if read naively. The first cut reported
"DB unreachable" on that basis. It now sends an explicit UA and trusts only a response that
parses as the health payload.

### Disposition

Staying `todo`. The watch condition is unchanged and still unmet; this card remains the watcher.

---

## 2. Description correction → WIC-1358

Re-fetch with `GET /api/issues/{id}` first (never the list endpoint — 1200-char clip, WIC-1214).
Replace the "Why waiting costs nothing" framing so the release condition reads two-clause:

> **Release requires BOTH:** (a) a first adjudicated-organic event in 551963, AND (b) root
> `GET /health` returning HTTP 200 with **both** `"status":"ok"` **and** `"db":"ok"`.
> Clause (b) was added 2026-08-27 —
> while prod is degraded (WIC-1386 / pending board decision WIC-1473) the server half of the
> WIC-814 taxonomy can only record failure, so traffic alone does not make the dashboards
> buildable. `organic_watch.py` now measures both and prints `COLLECTOR HEALTH:` on every run.

<!-- Clause (b) said `healthy` until WIC-1580 review. The handler never emits that string --
     `packages/api/src/app.ts:98` emits 'ok' | 'degraded', and "healthy" appears nowhere in
     packages/api/src. As written the clause was unsatisfiable, so pasting it into WIC-1358's
     description would have pinned the WIC-1024 hold permanently in the exact field that
     governs release. Same defect was fixed in code in the same PR (#192, commit 2041cf6).

     Then `"status":"ok"` alone turned out to be too weak in the other direction: the SAME
     line emits ok when `db === 'not_applicable'`, i.e. when neither the HYPERDRIVE binding
     nor DATABASE_URL is present and the DB was never probed. Production has no Hyperdrive
     binding and reaches Postgres only through the DATABASE_URL secret deploy.yml pushes, so
     a dropped secret push answers 200 {"status":"ok","hyperdrive":false,"db":"not_applicable"}
     with no database behind it. Clause (b) therefore requires `"db":"ok"` too, and
     classify_health() returns "unknown" -- never "ok" -- for that payload. -->


Also strike "there is nothing to fix and nothing to deploy" — there is: WIC-1473.

---

## 3. Comment → WIC-1024 (`2348363b-756a-4c63-8c5d-3549313d6108`)

**Hold unchanged, and now correctly attributed to two blockers, not one.**

Still `blocked`, still 0 organic events lifetime in 551963. Unchanged from the 08-26 checks.

What is new: the hold is no longer waiting only on traffic. Measured 2026-08-27, root
`GET /health` on both prod hosts returns `503 degraded` /
`"Too many subrequests by single Worker invocation"`. Every DB-touching endpoint is down for
authenticated users — WIC-1386, pending the pooler-vs-Hyperdrive board decision on **WIC-1473**.

For this card specifically: `resume_upload_completed` is emitted after the DB writes
(`resume.service.ts:596`) and cannot fire while the DB is unreachable, so the completion- and
timing-keyed insights and the C1–C3 `person_id` retention tiles are unbuildable regardless of
traffic. The 17/17 insights remain green and merged; nothing on my side regressed.

No action requested of the board on this card beyond what WIC-1473 already carries. Recording
it so the eventual release is not made on traffic alone.
