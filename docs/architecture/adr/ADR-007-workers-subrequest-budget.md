# ADR-007: The subrequest budget is a shared resource, and dependency retries must be charged against it

**Status:** Proposed — the code-level half is implemented; the infrastructure half needs a board decision (see _Open decision_).
**Date:** 2026-08-26
**Revised:** 2026-08-30 (WIC-1755) — root cause corrected. The earlier "IPv6-only
`db.<ref>.supabase.co`" diagnosis and the "repoint `DATABASE_URL`" remedy are
**withdrawn**; the host is derivable from CI, prod dials the IPv4 pooler, and the
database is provably up. Withdrawn claims are marked in place rather than deleted,
so the reasoning that produced them stays auditable.
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
`DATABASE_URL` directly and the Worker cannot complete that connect. This ADR
makes that failure fast, bounded and legible. It does not restore the data path.

**Correction (2026-08-30).** An earlier revision of this section blamed
`db.<ref>.supabase.co` resolving IPv6-only. **That claim is withdrawn: it is true
about a host production does not dial.** Prod dials the *transaction pooler*,
which is IPv4-only and reachable. See _Open decision_ for the derivation and the
measurements. The distinction matters because it moves the fault from "the
database is unreachable" to "the **Worker** cannot reach it" — a different
remediation set.

- `aws-1-us-west-2.pooler.supabase.com` (what prod dials) → **3 A records**
  (34.215.156.231, 44.225.139.66, 44.252.246.120), **0 AAAA**. TCP 6543
  connect from a general-purpose host: **0.03s**.
- `db.fnmuvgnkxdeupprcyvdt.supabase.co` (what the withdrawn claim blamed) →
  **0 A**, 1 AAAA. Real, IPv6-only, and not on production's path.

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

**Still live as of 2026-08-30T04:4xZ — roughly 4 days continuous** (first
measured 2026-08-26T12:51Z). Re-measured this heartbeat, byte-identical to every
prior reading:

```
GET https://jobtrail.al-23f.workers.dev/health  -> 503  (4.04s, 4.37s)
{"status":"degraded","hyperdrive":false,
 "db":"Too many subrequests by single Worker invocation. …"}
```

The signature has not drifted across four days of sampling. That rules out a
transient — and note it also argues *against* simple unreachability: a
reachability problem against a healthy three-address pool would be expected to
vary. A perfectly deterministic failure points at something structural in the
connect itself.

`GET /api/applications` still returns a clean `401`, so the Worker is routing and
only the data path is down. `hyperdrive:false` confirms prod takes the
`DATABASE_URL` branch (`db/client.ts:19`), which on `main` still passes no `max`
— i.e. the pool of 10 described above is what production is running right now.

### Settled 2026-08-30: the host is derivable, and PR #156 was right

**A previous revision of this section said the host `DATABASE_URL` names "is not
readable from the repository or the CF API" and that it "must be confirmed from
the console… no agent can read the secret." Both statements are false and are
withdrawn.** The secret is not hand-set: **CI constructs it on every deploy**, so
it is fully derivable from committed code plus readable Actions *variables*
(variables are readable via the API; only *secrets* are not). The error was
reading `db/client.ts`, which *consumes* the value, and never reading the
workflow that *builds* it.

Derivation, all from `origin/main`:

| input | source | value |
|---|---|---|
| `PROJECT_REF` | `vars.SUPABASE_URL` | `fnmuvgnkxdeupprcyvdt` |
| `PREFIX` | `vars.SUPABASE_POOLER_PREFIX` | `aws-1` |
| `REGION` | `vars.SUPABASE_POOLER_REGION` | **`us-west-2`** |
| branch taken | `secrets.SUPABASE_DATABASE_PASSWORD` **is set** | `deploy.yml:739` primary |

`deploy.yml:743` therefore builds, and `:751` exports to the deploy step:

```
postgresql://postgres.fnmuvgnkxdeupprcyvdt:***@aws-1-us-west-2.pooler.supabase.com:6543/postgres
```

Both branches force port 6543, so "pooler on 6543" holds regardless of which
fires. The production deploy step is even named
`Prepare DATABASE_URL (transaction pooler port 6543)` (`deploy.yml:729`).
**PR #156's claim that prod connects to the transaction pooler was correct**; the
earlier framing of #156 as "contradicting" this ADR is withdrawn — it corrected
it.

**Consequence: "repoint `DATABASE_URL` at the pooler" is a proven no-op and has
been removed as an option.** Prod already dials the pooler. The removed option
also named `aws-1-us-east-2.pooler.supabase.com` — the **wrong region**; it
matches neither the configured `us-west-2` nor the workflow's own `us-east-1`
default. Do not reintroduce it.

### The database is up — this is a Workers-egress fault

Independent of the Worker, the same credentials against the same pooler succeed:

- **`Deploy` run `33292619733`, head `614ad919`, success 2026-08-30T04:29:57Z.**
  Step 7 `Credential preflight (authenticated)` success; step 8
  **`Run database migrations` success**; step 12 deploy success. That step runs
  `db:migrate` + `db:rls` + `db:rls:verify` against the prod pooler and carries
  **no `if:` gate** (`deploy.yml:679`) — so prod Postgres accepted DDL and grants.
- `supabase-keepalive.yml` (byte-identical URL construction) logged
  `SELECT 1 returned: 1` against production at 2026-08-28T18:40:36Z, 54h into
  the outage.
- ~10 minutes after that successful deploy, prod `/health` was still
  **503 / `hyperdrive:false` / "Too many subrequests"**, unchanged.

Two conclusions the board should treat as established:

1. **"The database is down" is refuted.** The unreachable leg is Worker → Postgres
   and nothing else. The Supabase project is also **not paused** (the
   WIC-1283/WIC-1344 failure mode is excluded by the keepalive evidence).
2. **A redeploy is not a remedy — demonstrated twice.** The Worker was freshly
   redeployed in the 04:29:57Z run (and previously at `cfbd3a6f`, 08-29T23:39Z)
   and the signature did not move.

Corroborating the egress framing: preview Workers, which **do** have a Hyperdrive
binding, reach Postgres and return `password authentication failed for user
"postgres"` in ~0.7–1.9s. That error is **server-generated**, so it cannot be
received without a completed TCP connect and Postgres startup handshake. The
Hyperdrive path completes; the direct path never does. *Caveat, stated so nobody
over-reads it:* preview's Hyperdrive points at the shared **dev** database, so
that A/B varies the binding **and** the target DB, and the bare `postgres`
username shows the probe proves the *path* completes — it says nothing about
whether prod's credentials would authenticate through Hyperdrive.

### Candidate mechanism (hypothesis — not established)

Flagged explicitly as **unverified inference**, because it is actionable and
cheap to falsify, not because it is settled:

The pooler presents a **private** CA chain (`CN = *.pooler.supabase.com` ←
`Supabase Intermediate 2021 CA` ← `Supabase Root 2021 CA`; `openssl` returns
verify code 19). `Supabase Root 2021 CA` is not in the WebPKI trust store.
`db/client.ts` passes `ssl: 'require'` on the prod path only, which in
postgres-js 3.4.9 sets `rejectUnauthorized: false` and calls `tls.connect`. If
the Workers TLS stack validates against a public trust store and honours neither
`rejectUnauthorized: false` nor a custom `ca`, the handshake fails, postgres-js
reconnects with **no attempt ceiling**, and each dial spends a subrequest until
the budget is exhausted — which is the observed signature. This would also
explain why GitHub Actions (Node, which *does* honour `rejectUnauthorized:false`)
connects fine, and why the failure is perfectly deterministic.

**Falsification test, which merging this PR performs for free:** deploy and read
root `GET /health`. A `CERT_*` / `SELF_SIGNED_CERT_IN_CHAIN` /
`unable to verify the first certificate` string supports it; `ECONNREFUSED` /
`ETIMEDOUT` / `ENOTFOUND` refutes it and this paragraph should be deleted.
Note the discriminator is the **`db` field**, not the HTTP status: `/health`
returns 503 both before and after this change, so accept recovery only on
`db == "ok"`.

> **Correction (WIC-1916, 2026-09-01) — the private-CA hypothesis above is
> almost certainly a dead end; do not spend remediation on CA trust.** The
> hypothesis requires the Workers TLS stack to *ignore* `rejectUnauthorized:
> false`. But `postgres@3.4.9` `src/connection.js:283-284` sets
> `rejectUnauthorized = false` for `ssl` in `{'require','allow','prefer'}`, and
> the prod path passes `ssl: 'require'` (`db/client.ts`). Certificate
> verification is therefore *off* on this path by construction, so a CA that
> cannot be chained to a public root cannot be what fails these dials. The dials
> fail for a transport reason (host unreachable / connection refused), and the
> amplifier — the part this repo can bound and the part that turns a connect
> failure into a whole-budget outage — is the **ceiling-less initial-connect
> retry** (`connection.js`: `if (initial) return reconnect()`, `setTimeout(
> connect, 0)`), independent of TLS. See `db/connect-budget.ts` for the interim
> bound; the durable fix remains option 1 below.

### The decision left for the board

1. **Give prod a Hyperdrive binding, as preview has.** Hyperdrive terminates the
   connection outside the invocation, so the per-request connect disappears
   entirely and the failure mode above becomes unreachable rather than merely
   bounded. It is both the durable fix and the only remaining option that
   targets the identified fault. **Scope note:** PR #219 rewrote `README.md`,
   `packages/api/README.md` and `.dev.vars.example` to state that production has
   no Hyperdrive binding, so the implementing PR owes a same-PR sweep of those
   three files or it reintroduces the docs drift #219 existed to fix.
2. **Do nothing further and accept bounded degradation.** This ADR's code half
   already converts the outage from opaque 500s into an honest, fast 503. That
   is not a restoration of service.

Recommendation: **(1).** The divergence between the prod and preview database
paths is itself the root cause — preview was never exposed to this because
Hyperdrive removed the in-Worker connect.

This is a production deploy and requires board approval per the deployment
directive. Deploy-lane health is measurable and currently good: the last 10
`Deploy` runs on `main` are **8 success / 2 failure**, and both failures died at
step 7 `Credential preflight`, which aborts *before* migrations touch the
database.
