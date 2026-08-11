# ADR-0001: Fleet-wide Secrets & Credential Management Standard

## Status

**Accepted** (GO on all four pillars).

- **Proposed:** 2026-08-07 by the Architect (WIC-874).
- **Accepted:** 2026-08-09 — CTO go/no-go routed via WIC-877; board answered `adopt_all`. All four pillars adopted; DevOps owns execution.

> Numbering note: this decision is referenced throughout the codebase and docs as
> **ADR-0001** (four-digit), distinct from the earlier `ADR-001`…`ADR-006` series. The
> four-digit name is the one the shipped code, `CHANGELOG.md`, and
> `docs/architecture/CREDENTIAL_PREFLIGHT.md` already cite, so it is preserved here rather
> than renumbered.

## Context

Over roughly a week the fleet absorbed **8+ distinct credential incidents** across four
providers, each fixed as a one-off fire with no systemic guard:

- **GitHub (env-shadowing):** an invalid `GITHUB_TOKEN` in the instance `.env` shadowed a
  fully valid stored `gh` token, 401-ing every agent run. Root-cause took multiple
  heartbeats and spawned WIC-840/852/855/856/857/860. The daemon then cached the bad value,
  requiring a HOST restart. _(env precedence + stale process cache)_
- **Cloudflare (WIC-869):** API token scope insufficient for `wrangler deploy`.
  _(least-privilege set wrong)_
- **Supabase (WIC-863 / WIC-868):** dev-env creds stale and pointing at a _deleted_
  project, breaking CI preview migrations. _(no ownership/expiry tracking)_
- **Anthropic (WIC-751):** API key leaked via a Worker **binding name**.
  _(secret material in a non-secret field)_

Common thread: there is no standard contract for how secrets are named, scoped, validated,
rotated, or where they may appear. Each failure is subtle, cross-agent, and expensive
because nothing fails _loudly at boot_ — they fail deep in a run as an opaque 401/403.

## Decision

Adopt a lightweight fleet secrets standard with **four pillars**:

1. **Boot-time credential validation.** Each agent/worker validates its required
   credentials at startup (`gh auth status`, a cheap authenticated ping per provider) and
   refuses to start / emits a loud, structured error naming the bad var — instead of failing
   mid-run. This alone would have caught the `GITHUB_TOKEN` shadow in seconds.
2. **Explicit precedence + provenance contract.** Document the single source of truth per
   credential and the precedence order (e.g. the stored `gh` token is authoritative;
   `GITHUB_TOKEN` env is opt-in and must be valid or absent — never a stale placeholder).
   No secret is set to a "placeholder" value: **unset beats invalid.**
3. **No secret material in non-secret fields.** Secrets live only in the secret store /
   injected env — never in resource names, binding names, labels, or committed files. Add a
   CI lint (regex for `ghp_`, `sk-ant-`, etc.) over worker configs and manifests.
4. **Ownership, scope, and expiry registry.** A single registry (one doc/table) listing
   each credential: owner, provider, required scopes, rotation cadence, and expiry.
   Least-privilege scopes are recorded so mis-scoped tokens (Cloudflare) are caught at
   provisioning, and stale/deleted-project creds (Supabase) have a review date.

## Consequences

- **Positive:** credential failures surface at boot with an actionable message; recurring
  fire-fighting drops; provisioning gets a scope checklist; the leak surface shrinks.
- **Cost:** a small per-harness startup check + one CI lint rule + maintaining the registry.
  No architecture rewrite.
- **Non-goals:** this is **not** a secrets-vault migration and does **not** mandate rotation
  tooling — those can follow if the CTO wants. It relocates no existing secret; it adds a
  contract, a boot check, a lint, and a registry around where secrets already live (the `gh`
  credential store, injected process env, provider-side config, and Worker/wrangler secret
  bindings).

## Rollout

Delegated to DevOps-owned child issues (execution and review owned by DevOps; this ADR only
records the decision):

| Pillar        | Child   | Scope                                                            | Status                                          |
| ------------- | ------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Pillar 1      | WIC-878 | Boot-time credential validation helper + harness/CI wiring       | Helper shipped (PR #54, merged); card in review |
| Pillar 3      | WIC-879 | CI lint for secret material in non-secret fields                 | In review                                       |
| Pillars 2 & 4 | WIC-880 | Precedence/provenance contract + ownership/scope/expiry registry | In review                                       |

## Implementation

- **Pillar 1** is live: `packages/api/src/lib/credential-preflight.ts` runs one cheap
  **authenticated** ping per configured provider at API boot and in both CI deploy jobs,
  printing greppable `CREDENTIAL_PRECHECK_{OK,SKIP,FAIL}` lines that name the offending env
  var and provider without ever logging a secret value. It encodes the Pillar 2
  "unset beats invalid" contract for the `GITHUB_TOKEN` env-shadow trap. See
  **[`docs/architecture/CREDENTIAL_PREFLIGHT.md`](../CREDENTIAL_PREFLIGHT.md)** for the full
  helper reference, provider table, and run instructions.
- **Pillars 2, 3, and 4** land with WIC-879 / WIC-880; this record will be updated as those
  merge.

## References

- WIC-874 — ADR-0001 proposal (this decision).
- WIC-877 — CTO go/no-go; board answered `adopt_all` (all four pillars).
- WIC-878 — Pillar 1 rollout: boot-time credential validation helper (PR #54).
- WIC-879 — Pillar 3 rollout: CI secret-in-config lint.
- WIC-880 — Pillars 2 & 4 rollout: precedence/provenance contract + credential registry.
- `docs/architecture/CREDENTIAL_PREFLIGHT.md` — Pillar 1 implementation reference.
- Incident lineage: WIC-751 (Anthropic key leak), WIC-863 / WIC-868 (Supabase stale creds),
  WIC-869 (Cloudflare token scope), WIC-840 / 852 / 855 / 856 / 857 / 860 (GitHub env-shadow).
