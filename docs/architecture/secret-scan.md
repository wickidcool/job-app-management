# Secret-material CI lint (ADR-0001 Pillar 3 — WIC-879)

Cheap insurance against another Anthropic-style leak. In [WIC-751](https://linear.app) an
API key rode into production as the **value of a Worker binding** — a non-secret field
nobody thought of as a secret surface. ADR-0001 Pillar 3 makes that class of mistake a
red CI check.

> **Rule:** secrets live only in the secret store / injected env — never in resource names,
> binding names, labels, or any committed file.

## What runs

The `Scan for leaked secret material` step in `.github/workflows/deploy.yml` runs on every
push and PR:

```bash
npm run scan:secrets          # scan all git-tracked files
npm run -w @wic/api scan:secrets -- path/to/file    # scan explicit files
```

It scans every git-tracked text file (skipping `node_modules`, `dist`, lockfiles, binaries)
and **fails the job (exit 1)** with a GitHub annotation pointing at the exact
`file:line:col` and the offending **field** (binding / name / label / key). It never prints
the raw secret — only a redacted `prefix…(N chars)` fingerprint.

Implementation: pure, unit-tested core in `packages/api/src/lib/secret-scan.ts`; thin
file-discovery CLI in `packages/api/src/secret-scan.ts`.

## What it catches

**Prefix / shape patterns** (run on every file, require a realistic-length suffix so
placeholders like `sk-ant-...` or `ghp_xxx` never trip):

| Pattern                                          | Matches                            |
| ------------------------------------------------ | ---------------------------------- |
| `github-pat-classic` / `github-pat-fine-grained` | `ghp_…`, `github_pat_…`            |
| `anthropic-api-key`                              | `sk-ant-…`                         |
| `google-api-key`                                 | `AIza…` (Gemini/Google)            |
| `aws-access-key-id`                              | `AKIA…` / `ASIA…`                  |
| `slack-token`                                    | `xoxb/xoxp/…`                      |
| `twilio-account-sid` / `twilio-api-key`          | `AC…` / `SK…`                      |
| `cloudflare-api-token`                           | `cfut_…`                           |
| `private-key-block`                              | PEM / OpenSSH `PRIVATE KEY` blocks |

**Generic high-entropy tokens** (`high-entropy-token`) run **only on config/manifest files**
(`wrangler.*`, `.github/workflows/*`, `*.toml`, `.dev.vars*`) to keep false positives low.
The heuristic requires a ≥32-char base64url token with mixed letters+digits and Shannon
entropy ≥ 4.0 bits/char, and deliberately ignores pure-hex ids/SHAs, lowercase slugs, URLs
(`/`, `.`), and `KEY=VALUE` docs (`=`) — so Hyperdrive/R2 ids and connection strings stay
clean.

## Handling false positives (allowlist)

Two mechanisms — prefer the narrowest:

1. **Inline pragma** — annotate the source line:

   ```
   binding = "…"   # secret-scan:allow  <reason>
   #  (also accepted: `pragma: allowlist secret`)
   ```

2. **Central allowlist** — `.github/secret-scan-allowlist.json`:
   ```json
   {
     "allow": [
       { "file": "packages/api/test/fixtures/secret-scan/**", "reason": "scanner test fixtures" }
     ]
   }
   ```
   Each entry matches by `file` (path or `*`/`**` glob) and may be scoped further with
   `line` and/or `pattern`. Always include a `reason` for auditability. Keep entries as
   narrow as possible.

If a match is a **real** secret: remove it from the committed field and source it from the
secret store / injected env (e.g. `wrangler secret put`, GitHub Actions secret), then rotate
the exposed credential.
