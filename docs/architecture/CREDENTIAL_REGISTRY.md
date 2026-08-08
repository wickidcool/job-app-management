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
| `CLOUDFLARE_API_TOKEN` (prod, `cfut_…`) | Cloudflare | DevOps / CEO (account owner) | Pages: Edit; Workers Scripts: Edit; Account: Read — **account-scoped to the deploy account only**. Mis-scoped/over-broad tokens are the WIC-869 failure. | Annually, or on compromise | **2026-11-08** | Company Cloudflare token; installed as GitHub prod secret (WIC-633) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | DevOps | Non-secret identifier; must match the token's account | On account change | 2026-11-08 | GH secret / CI env (`CLOUDFLARE_ACCOUNT_ID`) |
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
