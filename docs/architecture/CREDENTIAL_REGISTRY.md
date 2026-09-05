# Credential Registry (ADR-0001 Pillar 4)

The canonical, metadata-only inventory of every credential the fleet depends on. One row
per credential: who owns it, the **least-privilege** scopes it should carry, how often it
rotates, when it is next due for review, and its single **authoritative source**.

Origin: ADR-0001 (WIC-874), approved GO by CTO on WIC-877. Precedence rules for the
*Authoritative source* column are defined in
[CREDENTIAL_PRECEDENCE.md](./CREDENTIAL_PRECEDENCE.md) (Pillar 2). Env-var locations per
environment are in [CLOUD_ENV_SECRETS.md](./CLOUD_ENV_SECRETS.md).

> **No secret values live here — metadata only.** This file is committed to the repo. If
> you are about to paste a token, stop: put the *name* of the source, not the value. The
> Pillar 3 secret-scan ([secret-scan.md](./secret-scan.md)) fails CI if a real secret lands
> in a tracked file.

Registry maintained by: **DevOps** (agent 288abc97, al@wickidcool.com). Reviewed at least
quarterly; individual rows may carry an earlier review date after an incident.

## Registry

### Core providers (the four named in ADR-0001)

| Credential | Provider | Owner | Required scopes (least-privilege) | Rotation cadence | Next review / expiry | Authoritative source |
|---|---|---|---|---|---|---|
| `Github api key` (canonical GitHub PAT, `ghp_…`) | GitHub | DevOps / al@wickidcool.com | `repo`, `workflow`, `admin:org` (org automation). Trim `admin:org` if org-level actions stop being needed. | Annually, or on compromise | **2026-11-08** | Company secret store, key `Github api key` (see [precedence](./CREDENTIAL_PRECEDENCE.md), GitHub row) |
| `GITHUB_TOKEN` (GH Actions ephemeral) | GitHub | GitHub Actions (auto) | Job-scoped, default read; elevate per-workflow only as needed | Per-run (ephemeral) | n/a (ephemeral) | GitHub Actions runtime |
| `LAYER0_DRIVER_TOKEN` (org Actions secret) | GitHub | DevOps / al@wickidcool.com | **Target: `Actions: read and write` on all org repos and nothing else** — a GitHub App installation token (preferred) or a fine-grained PAT. Cross-repo `actions:write` is required and the ephemeral `GITHUB_TOKEN` cannot provide it at any scope. | Annually; **immediately on the v1 → target swap** | **2026-09-19** (deliberately early — see note below) | Org Actions secret `LAYER0_DRIVER_TOKEN`, visibility *selected* → `job-app-management` only |
| `CLOUDFLARE_API_TOKEN` (prod, `cfut_…`) | Cloudflare | DevOps / CEO (account owner) | Pages: Edit; Workers Scripts: Edit; Account: Read — **account-scoped to the deploy account only**. Mis-scoped/over-broad tokens are the WIC-869 failure. | Annually, or on compromise | **2026-11-08** | Company Cloudflare token; installed as GitHub prod secret (WIC-633) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | DevOps | Non-secret identifier; must match the token's account | On account change | 2026-11-08 | GH secret / CI env (`CLOUDFLARE_ACCOUNT_ID`) |
| `CLOUDFLARE_CAREERPIN_API` (marketing deploy) | Cloudflare | DevOps / CEO (account owner) | **Inferred from call sites — not measured; see note below.** Account: Read; DNS: Edit on zones `ace9c419c6a5129cf7b8d104528a29e1` (`careerpin.app`) and `e31283e2f9ddc738087daaf4698fb88c` (`careerpin.io`); Pages: Edit on project `careerpin-marketing`. A revoked token cannot be probed, so this column is derived from what `deploy-marketing.yml` calls, not from the token's actual grant. | Annually, or on compromise | ⛔ **REVOKED — measured 2026-09-05** (run `33983093085`). Rotation pending on **WIC-2100**; re-set this date when a working token lands. | Company Cloudflare token; installed as a **repo-level** GitHub Actions secret `CLOUDFLARE_CAREERPIN_API` (set by board 2026-06-11) |
| `SUPABASE_SERVICE_KEY` (`service_role`) | Supabase | DevOps / al@wickidcool.com | Server-side only; bypasses RLS. Never shipped to the client bundle. | On compromise | **2026-11-08** | Supabase project `fnmuvgnkxdeupprcyvdt` → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase | DevOps | Client-safe; respects RLS. Must belong to the prod project ref. | On project/JWT rotation | 2026-11-08 | Supabase project `fnmuvgnkxdeupprcyvdt` → Settings → API |
| `SUPABASE_JWT_SECRET` | Supabase | DevOps | Token signing/verification only | On compromise | **2026-11-08** | Supabase project `fnmuvgnkxdeupprcyvdt` → Settings → API → JWT |
| `SUPABASE_DATABASE_PASSWORD` | Supabase | DevOps / al@wickidcool.com | Postgres role password; pooler URL is rebuilt from `SUPABASE_URL` + this | On compromise | **2026-11-08** | Supabase project `fnmuvgnkxdeupprcyvdt` DB settings |
| `SUPABASE_URL` / project ref | Supabase | DevOps | Non-secret; **selects the project** (prod = `fnmuvgnkxdeupprcyvdt`; `qtiaf…` = dev). All Supabase creds must belong to the ref this points at. | On project change | 2026-11-08 | Supabase dashboard (prod project ref) |
| `ANTHROPIC_API_KEY` | Anthropic | Anthropic account owner (al@wickidcool.com) | Model inference only; no admin/billing scope on the runtime key | Immediately on suspected leak (WIC-751); else annually | **2026-11-08** | Anthropic console → API keys |

### Incident-history providers (in use, tracked)

| Credential | Provider | Owner | Required scopes (least-privilege) | Rotation cadence | Next review / expiry | Authoritative source |
|---|---|---|---|---|---|---|
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Google (Gemini) | al@wickidcool.com | Generative Language API only. Billing/auto-reload cap is an account setting, not a key scope (credit depletion ≠ invalid key — WIC-787). | On compromise | **2026-11-08** | Google AI Studio → API keys |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | Twilio | al@wickidcool.com | Messaging/API for the one project SID; use a subaccount/API key rather than the root auth token where possible | On compromise | 2026-11-08 | Twilio console → Account |

### Emerging (not yet provisioned)

| Credential | Provider | Owner | Required scopes (least-privilege) | Rotation cadence | Next review / expiry | Authoritative source |
|---|---|---|---|---|---|---|
| `POSTHOG_API_KEY` | PostHog | CEO | Project ingest key (analytics events) only | On compromise | On provision (WIC-821 blocker) | PostHog project settings — **not yet created** |

### Note — `LAYER0_DRIVER_TOKEN` is a v1 stopgap (WIC-1113)

`layer0-driver.yml` re-enables and dispatches the Layer 0 secret-history audit across all 13
in-scope repos. Layer 0 auto-disables on **public** repos after 60 days of no repository
activity, and auto-disable also blocks `workflow_dispatch` — so the driver must hold
cross-repo `actions:write`, which the ephemeral `GITHUB_TOKEN` cannot grant.

**Provisioned 2026-08-19 with the existing canonical PAT (`Github api key`, `ghp_…`) as a
v1 stopgap.** That token carries `repo`, `workflow` and `admin:org` — far broader than the
`actions:write` the driver actually uses. It was chosen only because a GitHub App and a
fine-grained PAT both require a browser flow that no agent can complete; the alternative was
leaving the control unarmed while 5 dormant public repos lost Layer 0 on ~2026-10-18.

This row therefore carries a **deliberately early review date (2026-09-19)**. Closing it is a
credential swap with **no code change** — the workflow reads `secrets.LAYER0_DRIVER_TOKEN`
and nothing else:

1. Create a GitHub App installed org-wide with `Actions: read and write` (preferred), or a
   fine-grained PAT scoped to all `wickidcool` repos with `Actions: read and write` only.
2. `gh secret set LAYER0_DRIVER_TOKEN --org wickidcool --visibility selected --repos job-app-management`
3. Dispatch `layer0-driver.yml` once and confirm the run is green.
4. Update this row's scope, cadence and review date; drop this note.

Until step 4 lands, treat this row as **over-privileged and known**, not as compliant.

### Note — `CLOUDFLARE_CAREERPIN_API` is revoked, and its scopes are inferred (WIC-2119)

This row was **added after the credential had already died**, and the two facts are causally
linked: it had no row, so it had no owner and no review date, so nothing was in a position to
notice. It is the worked example for the last bullet under *How to use this registry*.

**Measured 2026-09-05**, run `33983093085` (`careerpin-redirect-ownership-probe.yml`, 18:07:57Z):
`GET /accounts` returned **403 / Cloudflare code 9109** *"Invalid access token"*, and the
secondary zone-read control returned **403 / 9109** as well. The control is what makes the verdict
unambiguous — a token that is merely under-scoped still reads its own zone. The run concludes
`FATAL: token is REVOKED or EXPIRED — it cannot read its own zone either.`

**It is not `CLOUDFLARE_API_TOKEN`, which is alive.** Measured the same day, run `33989113004`
(20:06:40Z): `GET /accounts/{id}/tokens/verify` → **HTTP 200**, status `active`; corroborated by
`deploy.yml`'s Deploy Production job succeeding at 19:19:59Z. Two Cloudflare tokens, two different
states, similar names. Do not reason about one from the other.

**The *Required scopes* column above is inferred, not measured, and that is a permanent property of
this row while the token stays revoked** — nothing can be probed about a credential that 403s on
every call. The entries are read off `deploy-marketing.yml`'s call sites: `GET /accounts` (`:43-56`),
the DNS CNAME upserts on both zones (`:109-113`), and Pages `add_domain` on `careerpin-marketing`
(`:156+`). Treat them as *what the workflow needs*, not as *what the token was granted* — the two
may differ, and the difference is exactly what a rotation should resolve. **When the token is
replaced, verify the grant and relabel this column as measured.**

Consumers: `deploy-marketing.yml` (production marketing deploy — DNS + Pages, the only writer),
`careerpin-redirect-ownership-probe.yml`, `cf-token-capability-probe.yml` and
`remediate-worker-secret-leak.yml` (all read-only). The probe's failure is what surfaced this.

⚠️ **Do not file another rotation ask.** WIC-2100 carries the pending one; WIC-2114 is a duplicate
of the same finding. ⚠️ **WIC-2118 may change which token `deploy-marketing.yml` uses** — it is
probing whether the live `CLOUDFLARE_API_TOKEN` can take over. This row describes today's measured
state; if that probe lands, revisit the consumer list and this note rather than assuming either
outcome.

## Column definitions

- **Owner** — the human or role accountable for the credential's validity and rotation.
- **Required scopes** — the *minimum* privileges the credential must carry. Provisioning a
  new copy uses this as a checklist; anything broader is over-privileged and should be
  trimmed (this is what catches the WIC-869 mis-scope class at provisioning time).
- **Rotation cadence** — the routine schedule, *plus* the standing rule: rotate immediately
  on any suspected compromise, regardless of schedule.
- **Next review / expiry** — the date this row must be re-checked (scope still minimal? key
  still valid? owner still correct?). Providers here don't expose hard expiry dates, so this
  is a *review* date; treat a passed date as a stale row.
- **Authoritative source** — where the value of record lives, per
  [CREDENTIAL_PRECEDENCE.md](./CREDENTIAL_PRECEDENCE.md) Rule 1. Everything else is a derived
  copy to be reconciled to this.

## How to use this registry

- **Provisioning a new credential or copy?** Find (or add) its row, and grant only the
  *Required scopes*. If the provider offers a narrower token type (subaccount, project-scoped
  key, fine-grained PAT), prefer it.
- **Reviewing (quarterly, or when a review date passes)?** For each row confirm: owner still
  correct, scopes still minimal (revoke any excess), key still valid (Pillar 1 preflight),
  and bump the *Next review* date.
- **Rotating?** Update the **authoritative source** first, then every derived copy
  (reconciliation checklist in [CREDENTIAL_PRECEDENCE.md](./CREDENTIAL_PRECEDENCE.md)), then
  re-run the preflight, then revoke the old value.
- **Adding a provider?** Add a row here *before* it ships. A credential with no registry row
  has no owner and no review date — the exact gap this pillar closes.

## Related

- ADR-0001 (WIC-874) — the standard this implements.
- [CREDENTIAL_PRECEDENCE.md](./CREDENTIAL_PRECEDENCE.md) — Pillar 2, precedence/provenance.
- [CREDENTIAL_PREFLIGHT.md](./CREDENTIAL_PREFLIGHT.md) — Pillar 1, boot-time validation.
- [secret-scan.md](./secret-scan.md) — Pillar 3, secret-material lint.
- [CLOUD_ENV_SECRETS.md](./CLOUD_ENV_SECRETS.md) — where each var lives per environment.
