# Credential Preflight (ADR-0001 Pillar 1)

Boot-time credential validation. Each agent/worker/CI job runs a cheap **authenticated**
ping per configured provider before doing real work, so a bad credential fails **loudly
and greppably at boot** — naming the exact env var and provider — instead of failing deep
in a run as an opaque 401/403.

Origin: [ADR-0001](./adr/ADR-0001-fleet-secrets-credential-management.md) (WIC-874),
approved GO by CTO on WIC-877. This preflight is **Pillar 1** of that four-pillar standard;
implemented in WIC-878.

## Why

Over ~a week the fleet absorbed 8+ credential incidents (GitHub env-shadow, Cloudflare
token scope, Supabase deleted-project creds, Anthropic key leak). Every one failed silently
mid-run and cost multiple heartbeats to root-cause. The single highest-leverage fix is to
validate at boot. In particular, this would have caught the `GITHUB_TOKEN` env-shadow in
seconds instead of ~6 issues over days.

## What it does

`packages/api/src/lib/credential-preflight.ts` is a small, dependency-injected helper
(`env`, `fetch`, `exec` are all injectable, so every path is unit-tested without touching
the network). Per provider it runs one cheap authenticated call:

| Provider   | Vars                                       | Check                                                            |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------- |
| github     | `GITHUB_TOKEN` / stored `gh`               | `GET api.github.com/user` with the token; else `gh auth status`  |
| anthropic  | `ANTHROPIC_API_KEY`                        | `GET api.anthropic.com/v1/models`                                |
| gemini     | `GEMINI_API_KEY` / `GOOGLE_API_KEY`        | `GET generativelanguage.googleapis.com/v1beta/models`            |
| cloudflare | `CLOUDFLARE_API_TOKEN`                     | `GET api.cloudflare.com/client/v4/user/tokens/verify`            |
| supabase   | `SUPABASE_URL` + `SUPABASE_ANON_KEY`       | `GET {SUPABASE_URL}/rest/v1/` with the anon key                  |
| twilio     | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | `GET api.twilio.com/2010-04-01/Accounts/{SID}.json` (basic auth) |

Each check returns a structured result and is printed as one greppable line:

```
CREDENTIAL_PRECHECK_FAIL provider=github var=GITHUB_TOKEN reason=unauthorized detail="..."
CREDENTIAL_PRECHECK_OK   provider=anthropic var=ANTHROPIC_API_KEY detail="..."
CREDENTIAL_PRECHECK_SKIP provider=twilio reason=not-configured detail="..."
```

**No secret values are ever logged** — only the env-var _name_, the provider, and HTTP
status codes.

### The GitHub env-precedence trap (ADR-0001 Pillar 2)

The env `GITHUB_TOKEN` takes precedence over the stored `gh` credential. A stale/invalid
value therefore silently _shadows_ a valid stored token and 401s every run. The github
check encodes the contract **"unset beats invalid"**: if `GITHUB_TOKEN` is present it is
validated directly and a bad value is a **hard failure** — even when `gh auth status` would
otherwise pass. Only when `GITHUB_TOKEN` is absent does it fall back to the stored `gh`
credential.

## Configured vs. required

A provider whose vars are unset is `skipped` (not failed) unless it is explicitly
**required**. Every provider passed to `runPreflight` / the CLI is required by default, so
`preflight -- cloudflare supabase` fails if either is unconfigured or invalid.

## How to run it

CLI (exit 0 = all valid, 1 = a check failed, 2 = no valid providers selected):

```bash
npm run -w @wic/api preflight -- cloudflare supabase   # explicit set (both required)
PREFLIGHT_PROVIDERS=github,anthropic npm run -w @wic/api preflight
npm run -w @wic/api preflight -- all                   # every provider
```

### Wired-in call sites

- **API server boot** (`packages/api/src/index.ts`): before `serve()`, the server validates
  its _configured_ providers (github if `GITHUB_TOKEN` set, anthropic, supabase) and refuses
  to start on failure. Unconfigured providers are skipped, so local dev without keys is
  unaffected. Opt out with `PREFLIGHT_ON_BOOT=false`.
- **CI** (`.github/workflows/deploy.yml`): a "Credential preflight (authenticated)" step in
  both the preview and production deploy jobs runs `preflight -- cloudflare supabase` before
  migrations/deploy — upgrading the previous **presence-only** (`-z`) checks to real
  authenticated pings.

### Fleet agent harness

The helper is intentionally standalone and provider-pluggable so the Paperclip agent daemon
can invoke it at startup (e.g. `preflight -- github anthropic gemini`) to catch the
env-shadow / credit-depletion classes at boot. That daemon lives outside this repo; wiring it
in is a follow-up owned with the platform.

## Tests

`packages/api/test/credential-preflight.test.ts` proves a bad credential fails loudly at
boot, including the GitHub env-shadow trap (invalid `GITHUB_TOKEN` fails even when the stored
`gh` token is valid), the unauthorized/missing-var/not-configured/network-error paths, and
that the formatted line never leaks the secret value.
