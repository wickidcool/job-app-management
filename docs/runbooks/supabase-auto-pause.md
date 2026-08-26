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
clock ticking, and escalated on that basis. It was wrong: Supabase's own pause email for
`fnmuvgnkxdeupprcyvdt`, timestamped `2026-08-25T17:19:29Z`, is documentary proof that what happened
was a **pause**. Check the owner's inbox before theorising from DNS.

> ⚠️ Do **not** repeat the "it recovered unattended, so it can't have been deleted" argument. A
> paused free-tier project **never un-pauses itself** — restore is always an account-owner click.
> The reasoning is wrong even though its conclusion happened to be right, and believing in
> self-healing is what makes this runbook's prevention look optional.

Measure the outage from the **pause**, not from the first failed deploy: 17:19Z → restore, about
**6.5 hours**, not the ~2h you get by bracketing `deploy.yml` failures. A deploy-failure bracket
only measures when you happened to be deploying.

The counter-example was already in hand and got under-weighted: WIC-1285 observed `db.<ref>`
NXDOMAIN on the *demonstrably alive* dev project.

Do not diagnose deletion from DNS. Ever.

### How to actually tell paused from alive

**Do this first: ask the Management API.** Everything below it is inference; this is the record.

```bash
gh workflow run supabase-project-status.yml --ref main -f mode=status -f target=both
```

`GET /v1/projects/{ref}` returns the project's real lifecycle `status`, which settles
paused-vs-deleted in one call. §6 covers it in full, including what each response actually
licenses you to conclude. Reach for the side-channel signals below only when that call is
unavailable — which today means whenever `SUPABASE_ACCESS_TOKEN` is not provisioned (WIC-1344).

| Signal | Paused | Alive |
|---|---|---|
| **Management API `status`** | **`INACTIVE`** | **`ACTIVE_HEALTHY`** |
| Pooler connect (`psql`) | `Tenant or user not found` | `SELECT 1` returns `1` |
| PostgREST `/rest/v1/...` | connection failure / 5xx | returns a **pgcode** (e.g. `42501`) — only a live DB emits one |
| `/auth/v1/token` bad creds | empty `{}` / `AUTH_ERROR` | `"Invalid login credentials"` |
| `db.<ref>.supabase.co` DNS | NXDOMAIN | **also frequently NXDOMAIN — useless** |

Both healthy and dead auth endpoints return **HTTP 401**. Discriminate on the **message body**,
never the status code.

Without the Management API, the fastest authoritative check is to run the keep-alive workflow
(above): it prints `✅ <env> (<ref>) is awake` or names the pause explicitly. Note what it *cannot*
tell you — `Tenant or user not found` is emitted for a paused project, a rotated password, and a
deleted one alike.

## 3. When a project has already paused

**First choice: restore it from the Management API** — see §6. That is the only path that does not
depend on one person being awake.

**Fallback: only the Supabase account owner can restore it, from the console.** It will not recover
on its own. Escalate to Allan (`al@wickidcool.com`) with the project ref. On that path **MTTR is
bounded entirely by one human's availability, with no automatic floor** — which is exactly what
§6 exists to remove.

Urgency is about downtime, not data loss: the pause email grants a **90-day** window to restore
before data is at risk (for the 08-25 pause that would have been 2026-11-23). So there *is* a
retention clock — it is simply nowhere near operative, and it should not be used to inflate the
severity of a pause.

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

Note this is **orthogonal to §6**. Pro removes auto-pause, but paused-vs-deleted ambiguity and
console-only restore exist on every plan tier, so the Management API capability is worth having
either way.

## 6. The Management API — the authoritative answer, and self-restore

**Card:** WIC-1344 · **Workflow:** `.github/workflows/supabase-project-status.yml`

### The rule this section exists to enforce

> **NXDOMAIN does not mean deleted.** A paused project presents identically to a deleted one on
> DNS, on the pooler, and on the auth endpoint. **Never attach a data-loss deadline to a Supabase
> NXDOMAIN without a Management API `status` check.** WIC-1283 did exactly that and burned a P0 on
> a routine auto-pause.

### Usage

```bash
# Read-only. Reports the live status of both projects.
gh workflow run supabase-project-status.yml --ref main -f mode=status -f target=both

# Restore — fires POST /v1/projects/{ref}/restore, but ONLY if the status call
# just returned INACTIVE. A healthy project is refused before any POST is made.
gh workflow run supabase-project-status.yml --ref main -f mode=restore-if-paused -f target=production
```

Equivalent by hand, if you hold the token locally:

```bash
curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/fnmuvgnkxdeupprcyvdt | jq -r .status
```

### Reading the response — what each outcome licenses you to conclude

| Response | Means | Do |
|---|---|---|
| `200` + `ACTIVE_HEALTHY` | project is up | If the app is still broken, the fault is **not** the project — look at creds, pooler region, Hyperdrive |
| `200` + `INACTIVE` | **paused** | Restore (below). Not deleted. No data at risk — the pause email grants 90 days |
| `200` + `COMING_UP` / `RESTORING` | restore already in flight | **Wait.** Do not re-fire restore |
| `200` + `PAUSING` / `GOING_DOWN` | pause in flight | Keep-alive lost the race; restore once it settles |
| `404` **and** `GET /v1/projects` succeeds | the ref is genuinely absent from this account | **This is the only signal that supports a deletion diagnosis.** Escalate as data loss |
| `404` **and** `GET /v1/projects` also fails | the token cannot see that org | Token/scope problem. **Do not escalate as data loss** |
| `401` / `403` | token invalid, revoked, or wrong account | Says **nothing** about whether the project is up. Rotate the token; diagnose separately |

That `404` split is the whole point. A bare 404 is as ambiguous as NXDOMAIN was; it only becomes
evidence when paired with a *successful* list call proving the token can see the account at all.
The workflow performs that second call automatically and refuses to phrase it as deletion
otherwise.

### The restore guard

`restore-if-paused` re-reads the status immediately before acting and calls `/restore` **only** when
it reads exactly `INACTIVE`. Anything else — healthy, transitional, unknown — is refused with no
POST. This is why the restore path can be documented and shipped without ever having been
test-fired against healthy production, which would be an unforced outage risk. Verified 2026-08-26
by executing the workflow's `run:` script, extracted from the parsed YAML, against a stub
Management API: 16/16 branches, including a negative control confirming the harness fails when the
guard is removed.

Restore is asynchronous. Supabase takes several minutes; re-run in `status` mode until it reads
`ACTIVE_HEALTHY`.

### The credential

`SUPABASE_ACCESS_TOKEN` — a Supabase Management API **personal access token** (`sbp_…`) created at
<https://supabase.com/dashboard/account/tokens> by the account that owns org `lnkenselppaqxstglvqq`
(`al@wickidcool.com`). A PAT carries the creating account's full authority and is **not**
scope-restrictable, so treat it as a high-value credential: one **repository-level** secret named
`SUPABASE_ACCESS_TOKEN` covers both projects. An environment-scoped secret of the same name also
works and takes precedence. Never commit it; the workflow passes it via the environment only and
never echoes it.

> **Status as of 2026-08-26: not yet provisioned.** Only the Supabase account owner can mint it —
> no agent can work around this. Until then the workflow fails on its first step with an explicit
> pointer rather than a confusing 401, and §3's console fallback is the live path.
