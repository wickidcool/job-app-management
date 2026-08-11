# Cloud Environment & Secrets Management

This document describes the environment configuration and secrets management strategy for the cloud deployment.

## Environment Overview

| Environment           | Purpose                       | Database                          | Auth           |
| --------------------- | ----------------------------- | --------------------------------- | -------------- |
| **Local Development** | Individual developer machines | Docker PostgreSQL or Supabase CLI | Supabase local |
| **Preview**           | PR review deployments         | Supabase (preview branch)         | Supabase       |
| **Production**        | Live user-facing deployment   | Supabase (production)             | Supabase       |

## Environment Variables

> **⚠️ Supabase key type matters — never ship the secret key to the browser.**
> Supabase's current API keys come in two forms, and picking the wrong one is a security incident, not a style choice:
>
> - **Publishable / anon key** — `sb_publishable_…` (current scheme) or a legacy `eyJ…` **anon** JWT. Browser-safe and **respects Row-Level Security (RLS)**. Every `*_ANON_KEY` variable below — including the `VITE_`-prefixed, build-time ones that are baked into the public SPA bundle — must hold **this** key.
> - **Secret / service key** — `sb_secret_…` (current scheme) or a legacy `eyJ…` **service_role** JWT. **Bypasses RLS.** Server-side only; store it as `SUPABASE_SERVICE_KEY` and only ever as a secret (Wrangler secret / CF secret). **Never** place it in a `VITE_*` variable, any `*_ANON_KEY` variable, or a non-secret GitHub Actions **variable** — those all end up readable in the client bundle or build logs, and a `sb_secret_` value there lets anyone read it and bypass RLS on the database.
>
> Rule of thumb: if a value flows into the client bundle (any `VITE_*`) it must be `sb_publishable_…` / anon. If it begins `sb_secret_`, it belongs only in `SUPABASE_SERVICE_KEY` as a secret.

### Frontend (Vite)

All frontend env vars must be prefixed with `VITE_` to be exposed to the client bundle.

| Variable                 | Local                   | Preview       | Production    | Sensitive                                                                   |
| ------------------------ | ----------------------- | ------------- | ------------- | --------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | `.env.local`            | CF Pages env  | CF Pages env  | No                                                                          |
| `VITE_SUPABASE_ANON_KEY` | `.env.local`            | CF Pages env  | CF Pages env  | No — **publishable/anon key only** (see callout above); never `sb_secret_…` |
| `VITE_API_URL`           | `http://localhost:3000` | (same origin) | (same origin) | No                                                                          |

### Backend / Pages Functions

| Variable               | Local        | Preview   | Production | Sensitive                                                              |
| ---------------------- | ------------ | --------- | ---------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`         | `.env.local` | CF secret | CF secret  | **Yes**                                                                |
| `SUPABASE_URL`         | `.env.local` | CF env    | CF env     | No                                                                     |
| `SUPABASE_ANON_KEY`    | `.env.local` | CF env    | CF env     | No — **publishable/anon key only**; never `sb_secret_…`                |
| `SUPABASE_SERVICE_KEY` | `.env.local` | CF secret | CF secret  | **Yes** — this is the `sb_secret_…` / service_role key (RLS-bypassing) |
| `SUPABASE_JWT_SECRET`  | `.env.local` | CF secret | CF secret  | **Yes**                                                                |
| `R2_ACCESS_KEY_ID`     | `.env.local` | CF secret | CF secret  | **Yes**                                                                |
| `R2_SECRET_ACCESS_KEY` | `.env.local` | CF secret | CF secret  | **Yes**                                                                |
| `R2_BUCKET_NAME`       | `.env.local` | CF env    | CF env     | No                                                                     |

### CI/CD (GitHub Actions)

| Secret                  | Purpose                       |
| ----------------------- | ----------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Deploy to Cloudflare Pages    |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `SUPABASE_DATABASE_URL` | Run migrations in CI          |

| Variable (non-secret) | Purpose                                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`        | Build-time Supabase URL                                                                                                                                                                                                                                                                 |
| `SUPABASE_ANON_KEY`   | Build-time anon key — **must be the `sb_publishable_…` / anon key**. This var is read by `deploy.yml` and passed to the build as `VITE_SUPABASE_ANON_KEY`, so its value is baked into the public SPA bundle. A `sb_secret_…` value here exposes the RLS-bypassing key to every visitor. |

## Local Development Setup

### Option 1: Supabase CLI (Recommended)

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Start local Supabase stack
npx supabase start

# Output includes local URLs and keys
# Copy these to packages/api/.env.local and packages/web/.env.local
```

The Supabase CLI starts:

- PostgreSQL on `localhost:54322`
- Auth API on `localhost:54321`
- Storage API on `localhost:54321`
- Studio UI on `localhost:54323`

### Option 2: Docker PostgreSQL (No Auth)

For backend-only development without auth:

```bash
# Start PostgreSQL
docker compose up -d postgres

# Use existing .env.local
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/job_app_manager
```

### Local Environment Files

```bash
# packages/api/.env.local (gitignored)
NODE_ENV=development
PORT=3000
HOST=127.0.0.1

# Database (Supabase local or Docker)
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

# Supabase (from `npx supabase start` output)
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long

# Local file storage
DATA_DIR=./data
```

```bash
# packages/web/.env.local (gitignored)
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_API_URL=http://localhost:3000
```

## Cloudflare Pages Configuration

### Environment Variables (Non-Sensitive)

Set via Cloudflare Dashboard or Wrangler:

```bash
# Via wrangler
wrangler pages project create jobapp
wrangler pages secret list --project-name=jobapp

# Environment variables (visible in build logs, safe for public values)
# Set in Cloudflare Dashboard > Pages > jobapp > Settings > Environment variables
```

Dashboard path: **Pages > jobapp > Settings > Environment variables**

| Variable                 | Value                     |
| ------------------------ | ------------------------- |
| `VITE_SUPABASE_URL`      | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...`                  |
| `SUPABASE_URL`           | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY`      | `eyJ...`                  |
| `R2_BUCKET_NAME`         | `jobapp-files`            |

### Secrets (Sensitive)

Set via Wrangler CLI only (never visible after creation):

```bash
# Database connection (use pooler URL for Workers compatibility)
wrangler pages secret put DATABASE_URL --project-name=jobapp
# Enter: postgres://postgres.xxx:password@aws-0-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# Supabase service key (admin access, server-side only)
wrangler pages secret put SUPABASE_SERVICE_KEY --project-name=jobapp
# Enter: eyJ... (from Supabase Dashboard > Settings > API)

# JWT secret for token validation
wrangler pages secret put SUPABASE_JWT_SECRET --project-name=jobapp
# Enter: your-jwt-secret (from Supabase Dashboard > Settings > API > JWT Settings)

# R2 credentials (if using S3-compatible API)
wrangler pages secret put R2_ACCESS_KEY_ID --project-name=jobapp
wrangler pages secret put R2_SECRET_ACCESS_KEY --project-name=jobapp
```

### R2 Bucket Binding

For direct R2 access from Workers (preferred over S3 API):

```toml
# wrangler.toml
name = "jobapp"
pages_build_output_dir = "packages/web/dist"

[[r2_buckets]]
binding = "FILES"
bucket_name = "jobapp-files"
```

## GitHub Actions Configuration

### Repository Secrets

Set via GitHub UI or CLI:

```bash
# Cloudflare deployment
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID

# Database migrations
gh secret set SUPABASE_DATABASE_URL
```

### Repository Variables

Non-sensitive values for build-time:

```bash
gh variable set SUPABASE_URL --body "https://xxx.supabase.co"
gh variable set SUPABASE_ANON_KEY --body "eyJ..."
```

### Environment Protection (Production)

Configure the `production` environment with:

- Required reviewers (optional)
- Wait timer before deploy (optional)
- Branch restrictions (main only)

Path: **Settings > Environments > production**

## Supabase Project Setup

### Required Configuration

1. **Database**
   - Create project at supabase.com
   - Note connection strings (pooler and direct)
   - Enable connection pooling (PgBouncer mode)

2. **Authentication**
   - Enable Email provider
   - Configure OAuth providers (Google, GitHub)
   - Set redirect URLs for each environment

3. **API Keys** (Supabase Dashboard > Settings > API)
   - **Publishable / anon key** (`sb_publishable_…`, or legacy `eyJ…` anon JWT): Client-side, respects RLS → goes in `*_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`
   - **Secret / service_role key** (`sb_secret_…`, or legacy `eyJ…` service_role JWT): Server-side, **bypasses RLS** → goes in `SUPABASE_SERVICE_KEY` only, always as a secret. Never expose it to the client.
   - JWT secret: For manual token validation

### Auth Redirect URLs

Configure in Supabase Dashboard > Authentication > URL Configuration:

```
# Local development
http://localhost:5173/auth/callback

# Preview deployments (wildcard)
https://*.jobapp.pages.dev/auth/callback

# Production
https://jobapp.pages.dev/auth/callback
https://app.yourdomain.com/auth/callback
```

## Secret Rotation

### Rotation Procedures

| Secret                 | Rotation Frequency         | Procedure                                            |
| ---------------------- | -------------------------- | ---------------------------------------------------- |
| `SUPABASE_SERVICE_KEY` | If compromised             | Regenerate in Supabase Dashboard, update CF secret   |
| `SUPABASE_JWT_SECRET`  | If compromised             | Regenerate in Supabase, update CF secret             |
| `R2_ACCESS_KEY_ID`     | Annually or if compromised | Create new R2 token, update secrets, revoke old      |
| `DATABASE_URL`         | If password compromised    | Reset password in Supabase, update connection string |
| `CLOUDFLARE_API_TOKEN` | Annually                   | Create new token, update GH secret, revoke old       |

### Post-Rotation Steps

1. Update the secret in Cloudflare Pages
2. Redeploy to pick up new value
3. Verify functionality in production
4. Revoke/delete the old credential

## Security Best Practices

1. **Never commit secrets** - Use `.env.local` files (gitignored)
2. **Principle of least privilege** - Use the publishable/`anon` key (`sb_publishable_…`) client-side, the `service_role`/secret key (`sb_secret_…`) server-side only. A `sb_secret_…` value must never reach a `VITE_*` var, an `*_ANON_KEY` var, or a non-secret GitHub Actions variable — anything baked into the client bundle is publicly readable and bypasses RLS.
3. **Rotate compromised secrets immediately** - Don't wait for scheduled rotation
4. **Use environment-specific values** - Never share secrets between preview and production
5. **Audit access** - Review who has access to Cloudflare, GitHub, and Supabase dashboards
6. **Monitor for leaks** - Set up GitHub secret scanning alerts

## Quick Reference

```bash
# View current secrets (names only)
wrangler pages secret list --project-name=jobapp

# Set a secret
wrangler pages secret put SECRET_NAME --project-name=jobapp

# Delete a secret
wrangler pages secret delete SECRET_NAME --project-name=jobapp

# Local Supabase credentials
npx supabase status

# Redeploy with new secrets
wrangler pages deploy packages/web/dist --project-name=jobapp --branch=main
```
