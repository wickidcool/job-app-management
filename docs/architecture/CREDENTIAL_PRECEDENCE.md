# Credential Precedence & Provenance Contract (ADR-0001 Pillar 2)

A single **authoritative source** per credential, and a defined **precedence order**
for every place a credential can come from. When two sources disagree, this document
says which one wins — and, critically, that an **unset** source beats an **invalid**
one.

Origin: ADR-0001 (WIC-874), approved GO by CTO on WIC-877. This is the doc-only half of
Pillar 2; the executable half (the GitHub env-shadow check) ships in the Pillar 1
preflight — see [CREDENTIAL_PREFLIGHT.md](./CREDENTIAL_PREFLIGHT.md). The per-credential
owner, scope, and review dates live in the [CREDENTIAL_REGISTRY.md](./CREDENTIAL_REGISTRY.md)
(Pillar 4).

## Why this exists

Across ~a week the fleet absorbed 8+ credential incidents. A recurring root cause was not
a *missing* credential but an **ambiguous** one: two sources for the same secret, and the
wrong one silently winning.

- **GitHub env-shadow** (WIC-855/WIC-859): a stale `GITHUB_TOKEN` in the daemon env
  silently shadowed a valid stored `gh` credential, 401-ing every run for ~6 issues over
  days. The env var *takes precedence* over the stored token, so a bad value there is worse
  than no value at all.
- **Supabase mispointed project** (WIC-863/WIC-868): prod `SUPABASE_URL` pointed at the
  *dev* project ref while the password/keys still held dev values — every source
  individually looked "set," but they disagreed about *which project* was authoritative.

The fix is a written contract: name the one authoritative source, order the fallbacks, and
forbid the failure mode that caused the most damage — the **stale placeholder**.

## The three rules

### Rule 1 — One authoritative source per credential

Every credential has exactly one **authoritative source** (recorded in the
[registry](./CREDENTIAL_REGISTRY.md), column *Authoritative source*). That is the value of
record. All other locations (a CI secret, a `.env`, an agent's injected env) are
**derived copies** and must be reconciled *to* the authoritative source, never the other
way around.

Example: the canonical GitHub token is the company secret **`Github api key`**. The daemon
`.env` `GITHUB_TOKEN`, a workspace's `gh` login, and the GitHub Actions `GITHUB_TOKEN` are
all derived copies. If they drift, the company secret wins and the copies get updated.

### Rule 2 — Precedence order: `unset` beats `invalid`

When a consumer can read a credential from more than one source, resolution follows a
defined order. The non-negotiable invariant:

> **An absent source must beat a present-but-invalid source.**

A source that is *unset* falls through to the next source in the order. A source that is
*set to a wrong value* must be treated as a **hard failure**, not silently overridden — it
is a signal that a copy has drifted and needs reconciliation.

Concretely, for GitHub (the class that bit us):

1. If `GITHUB_TOKEN` is **set**, it is authoritative for this process — the underlying
   tools (`gh`, `git`, `@octokit`) already prefer it over the stored login. It **must** be
   valid; a present-but-invalid `GITHUB_TOKEN` is a **hard failure** even when the stored
   `gh` credential would pass. It is never "fall back and hope."
2. If `GITHUB_TOKEN` is **unset**, fall back to the stored `gh` credential.
3. The stored `gh` credential should itself be reconciled to the company secret
   `Github api key`.

This is exactly what the Pillar 1 preflight encodes for `github`
([CREDENTIAL_PREFLIGHT.md](./CREDENTIAL_PREFLIGHT.md#the-github-env-precedence-trap-adr-0001-pillar-2)):
a present-but-invalid `GITHUB_TOKEN` fails the boot check instead of being papered over.

### Rule 3 — No credential is ever set to a placeholder

A secret is either its **real value** or **unset**. Never a placeholder, a "TODO", a
`changeme`, a copied-from-another-env value, or a truncated/expired stand-in.

Rationale: Rule 2 only works if `unset` is an honest signal. A placeholder defeats it — it
is *present* (so it wins precedence and shadows the real source) but *invalid* (so it
401s). The placeholder is the single worst state a credential can be in. If you don't have
the real value yet, **leave it unset** and let the preflight fail loudly with
`reason=not-configured` rather than `reason=unauthorized`.

This rule is enforced defensively by the Pillar 3 secret-scan
([secret-scan.md](./secret-scan.md)), which fails CI if secret-shaped material lands in a
non-secret field — the inverse footgun (WIC-751, an Anthropic key leaked as a Worker
*binding name*).

## Precedence, by provider

| Credential | Authoritative source | Precedence order (highest wins; `unset` falls through, `invalid` = hard fail) |
|---|---|---|
| GitHub token | Company secret `Github api key` | `GITHUB_TOKEN` env (must be valid) → stored `gh` login → company secret |
| Cloudflare API token | Company Cloudflare token (`cfut_…`) | `CLOUDFLARE_API_TOKEN` env / GH secret → company token. Never a per-user token in CI (scope drift → WIC-869). |
| Cloudflare account id | `CLOUDFLARE_ACCOUNT_ID` (non-secret) | GH secret / env. Must match the token's account (mismatch = mis-scope). |
| Supabase project | Prod `SUPABASE_URL` project ref (`fnmuvgnkxdeupprcyvdt`) | `SUPABASE_URL` selects the project; `ANON_KEY`/`JWT_SECRET`/`DATABASE_PASSWORD` **must** belong to *that* ref. Cross-project mixing = hard fail (WIC-863/868). |
| Supabase DB connection | `SUPABASE_DATABASE_PASSWORD` (+ `SUPABASE_URL` ref) | Prod job rebuilds the pooler URL from `SUPABASE_URL` + password; `SUPABASE_DATABASE_URL` is a **fallback only** when the password is empty. |
| Anthropic API key | Anthropic account (owner al@wickidcool.com) | `ANTHROPIC_API_KEY` env. Single source; on rotation, update everywhere at once (WIC-751). |
| Gemini API key | Google AI Studio account | `GEMINI_API_KEY` → `GOOGLE_API_KEY`. Either present must be valid; credit depletion ≠ invalid key (WIC-787). |
| Twilio | Twilio account | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` (both, or neither). |

The registry ([CREDENTIAL_REGISTRY.md](./CREDENTIAL_REGISTRY.md)) carries the owner,
least-privilege scopes, rotation cadence, and next-review date for each of these.

## Reconciliation checklist (when a copy drifts)

1. Identify the **authoritative source** for the credential (registry, *Authoritative
   source* column).
2. Read the true value from there.
3. Update every derived copy to match — do **not** edit the authoritative source to match a
   copy.
4. If you don't have the true value, **unset** the drifted copy (Rule 3) rather than
   leaving a stale one in place.
5. Run the Pillar 1 preflight for the affected provider(s) to confirm every configured
   source now validates.

## Relationship to the other pillars

- **Pillar 1 — Preflight** ([CREDENTIAL_PREFLIGHT.md](./CREDENTIAL_PREFLIGHT.md)):
  *enforces* Rule 2 at boot for GitHub (unset-beats-invalid) and validates every configured
  provider with a real authenticated ping.
- **Pillar 3 — Secret-material lint** ([secret-scan.md](./secret-scan.md)): backstops Rule
  3 by refusing to let secret-shaped material land in a committed non-secret field.
- **Pillar 4 — Registry** ([CREDENTIAL_REGISTRY.md](./CREDENTIAL_REGISTRY.md)): records the
  authoritative source (this doc's Rule 1) plus owner, scope, and review date per
  credential.
