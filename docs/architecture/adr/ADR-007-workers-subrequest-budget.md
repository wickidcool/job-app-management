# ADR-007: The subrequest budget is a shared resource, and dependency retries must be charged against it

**Status:** Proposed — the code-level half is implemented; the infrastructure half needs a board decision (see _Open decision_).
**Date:** 2026-08-26
**Context:** Production outage diagnosed in WIC-1386 / WIC-1387.

## Context

A Cloudflare Worker invocation gets a fixed number of outbound subrequests. Every
TCP connect and every `fetch()` draws on that one budget, and it does not refill
mid-invocation. Nothing in our code accounted for this, and on 2026-08-26 every
authenticated production endpoint returned 500 as a result:

```
GET https://jobtrail.al-23f.workers.dev/health  ->  503
{"status":"degraded","hyperdrive":false,
 "db":"Too many subrequests by single Worker invocation. …"}
```

The failure is in `connect`, before any SQL runs. Two independent design choices
turned an unreachable database into a total outage with no usable diagnosis:

1. **The connection pool was unbounded relative to the budget.** `postgres-js`
   defaults to a pool of 10 and re-dials a dead host with backoff and no attempt
   ceiling. Against a host that cannot be reached at all, one request could spend
   the entire budget dialling.
2. **Everything downstream of the exhaustion also needed the budget.** The retry
   in `worker.ts` needed subrequests it no longer had. So did the `track()` call
   that emits `resume_upload_failed` — which is why a real upload failure
   produced `resume_upload_submitted` in PostHog and no matching failure event
   (WIC-1387). The telemetry was destroyed by the condition it exists to report,
   and it fails this way _worst_ when failures cluster, because exhaustion hits
   many requests at once.

The second point is the one worth generalising. Budget exhaustion is not an
ordinary dependency error: it is a failure that **disables the mechanisms that
would report it**, so it presents as silence and false calm.

## Decision

**Treat the subrequest budget as a shared resource with an explicit reservation
discipline, not as an unlimited one.** Concretely:

1. **Bound what any single dependency may spend.** Both Workers database paths
   now use `max: 1` and `connect_timeout: 5`. `max: 1` makes the "exactly one
   connection per request" claim already written in `db/context.ts` true rather
   than aspirational.
2. **Never retry on exhaustion.** It cannot succeed, and it spends budget the
   response itself needs. `isSubrequestExhaustion()` is classified separately
   from `isHyperdriveTimeout()` — the latter stays retryable, because it is
   transient and fires before any SQL executes.
3. **Report exhaustion as availability, not as a bug.** It surfaces as `503
SERVICE_UNAVAILABLE` with `Retry-After: 5`, not as an opaque `500
INTERNAL_ERROR` indistinguishable from a broken query.
4. **Failure telemetry must not compete with the failure for budget.** Derive
   failure rates from the gap between a `_submitted` event and its terminal
   event, rather than trusting a `_failed` event that fires after the resource
   pressure that caused it. `_submitted` fires before any dependency work and so
   survives. (Consequence for WIC-1387. **Landed 2026-08-26 as `29f0d09` on
   `main` via WIC-1476** — the gap-derived definition is now the specified basis
   for the failure panels in `docs/analytics/dashboard-spec.md`. Note that
   `ctx.waitUntil()` was evaluated as an alternative and **rejected**: it defers
   work past the response but keeps it inside the same invocation, so it draws on
   the same exhausted subrequest budget and does not rescue the event.)

## Consequences

- A database that cannot be reached now costs one dial and yields one honest
  503, instead of draining the budget and returning 500 everywhere.
- `500 INTERNAL_ERROR` regains its meaning: a defect in a route, not an
  unreachable dependency.
- `max: 1` removes intra-request query concurrency on the Workers paths. This is
  not a regression — the request context already cached a single `sql` instance
  and every service call shared it.
- Any KPI derived from `*_failed` events under-reports, and does so worst during
  incidents. Panels built on those events need the gap-derived definition above.
- **The analytics deliverable is a second consumer of this decision, not just a
  bystander.** Reported from WIC-1580 on 2026-08-27 and worth recording here,
  because it was not written down anywhere. The WIC-814 event taxonomy splits
  across two transports and the legs behave oppositely under this outage:

  | leg | events | path | under the outage |
  |---|---|---|---|
  | client | `_started`, `_validation_failed`, `_cta_clicked` | browser → `us.i.posthog.com` | unaffected |
  | server | `_submitted`, `_completed`, `_failed` | Worker (`resume.service.ts`) | broken |

  Verified against `origin/main` (`d84da39`): `_submitted` is emitted at
  `resume.service.ts:451`, outside and above the `try` whose first statement is
  `getDb()` (`:458`), so it survives. There are **two** `_completed` emit sites,
  not one — `:486` (the duplicate-detection early return) and `:597` (the normal
  path) — and both sit downstream of `getDb()` and at least one `await db`
  read, so both are structurally unreachable. Every upload therefore falls
  through to `_failed` in the catch (`:760`). **While the DB is
  unreachable the server funnel can only ever record 100% failure.** So the
  completion/timing insights and the C1–C3 `person_id` retention tiles in
  WIC-1024 are unbuildable no matter how much traffic arrives — first organic
  traffic is necessary but *not* sufficient to release that hold. The second
  clause is this decision. Note this does not weaken §4: the gap-derived
  definition is what lets the funnel be *read correctly* under the outage; it
  does not manufacture the terminal events that never fired.

## What this does not fix

**The outage itself.** The connect fails because prod has no `HYPERDRIVE`
binding — `wrangler.jsonc` declares one only under `env.preview` — so prod dials
`DATABASE_URL` directly, and `db.<ref>.supabase.co` resolves IPv6-only, which
Workers cannot reach. This ADR makes that failure fast, bounded and legible. It
does not make the database reachable.

## Monitoring note

`GET /health` (root, unauthenticated) already probes the database and already
returns 503 with the underlying error. It was reported as unmonitorable because
the probe was pointed at `/api/health`, which sits behind `authMiddleware` and
does not exist — 401 unauthenticated, 404 authenticated. **Point the monitor at
`/health`.** No code change is required for this outage class to be caught.

**Match on the literal the handler actually emits.** Verified against
`origin/main` (`d84da39`) this heartbeat, `packages/api/src/app.ts:104-105`:

```ts
const status = db === 'ok' || db === 'not_applicable' ? 'ok' : 'degraded';
return c.json({ status, hyperdrive, db }, status === 'ok' ? 200 : 503);
```

The recovered state is `{"status":"ok"}` with HTTP 200. The string `healthy`
appears nowhere in `packages/api/src`, so any watcher or release condition keyed
on it is **unsatisfiable** — it would wait forever through an actual recovery.
Two had been written that way (a WIC-1580 watcher and the parked WIC-1358
release condition) and both were corrected on 2026-08-27; recorded here so the
next consumer of this section does not reintroduce it. Prefer asserting on the
HTTP status code (200 vs 503), which carries the same signal and has no literal
to get wrong.

## Open decision

**Still live as of 2026-08-27T00:53Z — roughly 20 hours continuous.**
Re-measured this heartbeat, both origins, byte-identical to the 2026-08-26T12:51Z
reading:

```
GET https://app.careerpin.app/health           -> 503  (4.5s)
GET https://jobtrail.al-23f.workers.dev/health  -> 503  (4.1s)
{"status":"degraded","hyperdrive":false,
 "db":"Too many subrequests by single Worker invocation. …"}
```

The signature has not drifted in 20 hours of sampling, which rules out a
transient and is consistent with a host that is simply unreachable rather than
overloaded.

`GET /api/applications` still returns a clean `401`, so the Worker is routing and
only the data path is down. `hyperdrive:false` confirms prod takes the
`DATABASE_URL` branch (`db/client.ts:19`), which on `main` still passes no `max`
— i.e. the pool of 10 described above is what production is running right now.

**Unresolved conflict — read before choosing option 1.** PR #156 (merged to
`main` 2026-08-26T12:39Z) now documents production as connecting to *"the
Supabase transaction pooler (port 6543) using the `DATABASE_URL` secret."* If
that is accurate, option 1 is a **no-op** and choosing it would spend a
production deploy without restoring service. #156 verified that prod resolves to
the `DATABASE_URL` branch — which is not in dispute — but the *host that secret
names* is not readable from the repository or the CF API, so that half of the
claim is inference, not measurement. It is contradicted by the observed
behaviour: a reachable IPv4 pooler would not fail in `connect`.

**Therefore the host must be confirmed from the console before either option is
actioned.** This is a human-only step; no agent can read the secret.

Two ways to make prod reachable, for the board:

1. **Repoint `DATABASE_URL` at the IPv4 pooler**
   (`aws-1-us-east-2.pooler.supabase.com`) rather than `db.<ref>.supabase.co`.
   Cheapest, and sufficient *only if the secret does not already name that host*
   — see the conflict above. `DATABASE_URL` is `secret_text` and unreadable via
   the CF API, so someone with console access must confirm which host it
   currently names before this option is chosen.
2. **Give prod a Hyperdrive binding, as preview has.** Hyperdrive terminates the
   connection outside the invocation, so the per-request connect disappears
   entirely and the failure mode above becomes unreachable rather than merely
   bounded. This is the durable fix and makes prod match the path preview
   already proves works.

Recommendation: **do (1) to restore service and (2) to keep it restored.** The
divergence between prod and preview database paths is itself the root cause —
preview was never exposed to this because Hyperdrive removed the connect.

Either is a production deploy and requires board approval per the deployment
directive.
