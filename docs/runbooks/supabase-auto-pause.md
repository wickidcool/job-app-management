# Runbook — Supabase free-tier auto-pause

**Owner:** DevOps · **Source cards:** WIC-1293 (prevention), WIC-1281 (the P0), WIC-1283 (the wrong diagnosis)

Supabase pauses free-tier projects after roughly **7 consecutive days with no database
activity**. Both of our projects are on the free tier of org `lnkenselppaqxstglvqq`:

| Environment | Project ref | Pooler host |
|---|---|---|
| production | `fnmuvgnkxdeupprcyvdt` | `aws-1-us-west-2.pooler.supabase.com:6543` |
| dev | `qtiafwokvkrdiashiudf` | `aws-1-us-west-2.pooler.supabase.com:6543` |

A paused production project is a **total user-facing outage**, not just a broken deploy lane.
The browser calls the same-origin `/api/*` Worker, the Worker calls Supabase, and every login
returns `AUTH_ERROR` with an empty `{}` body.

## 1. The prevention: `supabase-keepalive.yml`

`.github/workflows/supabase-keepalive.yml` opens a real Postgres connection to each project over
the transaction pooler and runs a single read-only `SELECT 1`, at **06:17 UTC every third day**
(`17 6 */3 * *` → days 1, 4, … 28, 31; largest gap 3 days, including across month boundaries).
That is a >2x margin, so one skipped or failed run still cannot let a project lapse.

Two properties worth not breaking:

- **`fail-fast: false` is load-bearing.** During WIC-1281 production was paused while dev still
  needed its own touch. Default fail-fast would have let the dead project cancel the live one's
  keep-alive.
- **It needs no new credential.** Both the `dev` and `production` GitHub environments already
  carry `SUPABASE_DATABASE_PASSWORD` plus the `SUPABASE_URL` / `SUPABASE_POOLER_REGION` vars.
  Note dev deliberately has **no** `SUPABASE_POOLER_PREFIX` and relies on the `aws-1` default,
  matching `deploy.yml` — that is correct, do not "fix" it (WIC-885).

To touch both databases on demand:

```bash
gh workflow run supabase-keepalive.yml --ref main
```

`schedule:` only ever fires from the **default branch**. This file is completely inert on a
feature branch — merging to `main` is what arms it (same trap as WIC-1113). GitHub also
auto-disables scheduled workflows in repos with 60 days of no activity.

## 2. ⚠️ NXDOMAIN does NOT mean the project was deleted

This is the single most expensive lesson from the 2026-08-25 incident, and it burned a P0.

**A paused Supabase project presents exactly the same way a deleted one does.** `db.<ref>.supabase.co`
goes NXDOMAIN when a project is *paused*; the DNS record is not a liveness signal and its absence
is not evidence of deletion. WIC-1283 filed the outage as a project deletion with a retention
clock ticking, and escalated on that basis. It was wrong — production recovered **unattended in
about two hours**, which a deleted project cannot do.

The counter-example was already in hand and got under-weighted: WIC-1285 observed `db.<ref>`
NXDOMAIN on the *demonstrably alive* dev project.

Do not diagnose deletion from DNS. Ever.

### How to actually tell paused from alive

| Signal | Paused | Alive |
|---|---|---|
| Pooler connect (`psql`) | `Tenant or user not found` | `SELECT 1` returns `1` |
| PostgREST `/rest/v1/...` | connection failure / 5xx | returns a **pgcode** (e.g. `42501`) — only a live DB emits one |
| `/auth/v1/token` bad creds | empty `{}` / `AUTH_ERROR` | `"Invalid login credentials"` |
| `db.<ref>.supabase.co` DNS | NXDOMAIN | **also frequently NXDOMAIN — useless** |

Both healthy and dead auth endpoints return **HTTP 401**. Discriminate on the **message body**,
never the status code.

The fastest authoritative check is just to run the keep-alive workflow (above): it prints
`✅ <env> (<ref>) is awake` or names the pause explicitly.

## 3. When a project has already paused

**Only the Supabase account owner can restore it, from the console.** No automation we currently
hold can do it — there is no `SUPABASE_ACCESS_TOKEN` provisioned, so no agent can call
`POST /v1/projects/{ref}/restore`. Escalate to Allan (`al@wickidcool.com`) with the project ref
and expect roughly a day of turnaround based on prior incidents.

Supabase emails `al@wickidcool.com` a **warning about 24.6 hours before** it pauses a project.
That inbox is the earliest reliable signal we have, and searching it is how WIC-1281 was cracked.

Observed history — three production pauses in five weeks:

| Warning email | Pause email | Lag |
|---|---|---|
| 2026-07-22T12:11Z | 2026-07-23T12:50Z | 24.6h |
| 2026-07-30T21:11Z | 2026-07-31T21:51Z | 24.7h |
| 2026-08-24T16:41Z | 2026-08-25T17:19Z | 24.6h |

## 4. Why this kept happening

Our own merge hygiene caused it. The `[skip ci]` no-deploy merge route (WIC-1250 / WIC-1212)
deliberately leaves the deploy lane unexercised, and running migrations on a deploy was the only
thing routinely touching the database. Fourteen consecutive `[skip ci]` merges starved Supabase of
activity for long enough to trip the idle timer. We built a pause generator by accident; the
keep-alive decouples DB liveness from deploy frequency.

## 5. Standing recommendation

Upgrading org `lnkenselppaqxstglvqq` to **Pro removes auto-pause outright** and is the honest fix
for something we call *production*. It is a recurring-spend decision for Allan, not an agent's.
The keep-alive is free and covers both projects today, so this is a recommendation, not a blocker.
Billing: <https://supabase.com/dashboard/org/lnkenselppaqxstglvqq/billing?panel=subscriptionPlan>
