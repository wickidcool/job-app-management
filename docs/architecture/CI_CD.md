# CI/CD Pipeline Documentation

This document describes the GitHub Actions CI/CD pipeline for the Job Application Manager.

## Overview

The pipeline runs on:
- **Push to `main`**: Full lint/test/build, database migrations, and production deployment
- **Pull requests to `main`**: Full lint/test/build and preview deployment

## Workflow File

`.github/workflows/deploy.yml`

## Pipeline Jobs

### 1. Lint & Test

Runs on all pushes and PRs:
- Checkout code
- Setup Node.js 20 with npm cache
- Install dependencies (`npm ci`)
- Run linter (`npm run lint`)
- Run type checking (`npm run typecheck`)
- Run tests (`npm run test`)
- Build all packages (`npm run build`)

### 2. Deploy Preview (PRs only)

Creates a preview deployment for each PR:
- Builds with preview environment variables
- Deploys to Cloudflare Pages on a branch-specific URL
- Posts the preview URL as a PR comment

### 3. Deploy Production (main branch only)

Deploys to production with safeguards:
- Uses the `production` GitHub environment (requires approval if configured)
- Concurrency group prevents parallel production deploys
- Runs database migrations before deployment
- Deploys to Cloudflare Pages production

## Required Secrets

Configure these in GitHub repository settings under Settings > Secrets and variables > Actions:

### Repository Secrets

| Secret | Description | How to obtain |
|--------|-------------|---------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Pages edit permission | [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) > Create Token > Edit Cloudflare Pages |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Cloudflare Dashboard > Account Home > right sidebar |
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string (pooler) | Supabase Dashboard > Project Settings > Database > Connection string (use Pooler mode) |

### Repository Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

### Environment Setup

1. Go to repository Settings > Environments
2. Create a `production` environment
3. Optionally configure:
   - **Required reviewers**: Require approval before production deploys
   - **Wait timer**: Add a delay before deployment starts
   - **Deployment branches**: Restrict to `main` only

## Cloudflare Pages Project Setup

Before the workflow can deploy, create the Cloudflare Pages project:

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create the Pages project
wrangler pages project create jobapp
```

Or create via the Cloudflare Dashboard:
1. Go to Workers & Pages
2. Create application > Pages
3. Connect to Git (select this repository)
4. Project name: `jobapp`
5. Build settings: Leave defaults (CI handles builds)

## Deployment URLs

| Environment | URL |
|-------------|-----|
| Production | `https://jobapp.pages.dev` (or custom domain) |
| Preview | `https://{branch}.jobapp.pages.dev` |

## Rollback Procedure

### Option 1: Revert via Git (Recommended)

Safest approach - creates an audit trail:

```bash
# Identify the bad commit
git log --oneline -10

# Create a revert commit
git revert <bad-commit-sha>

# Push to trigger new deployment
git push origin main
```

### Option 2: Cloudflare Dashboard Rollback

For immediate rollback without code changes:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to Workers & Pages > jobapp
3. Click on Deployments
4. Find a previous working deployment
5. Click the three dots menu > Rollback to this deployment

### Option 3: Re-deploy Previous Commit

```bash
# Hard reset to previous commit (careful - rewrites history)
git reset --hard <previous-commit-sha>
git push --force origin main

# Or create a new branch from the old commit and deploy
git checkout -b hotfix/<previous-commit-sha>
git push origin hotfix/<previous-commit-sha>
```

### Database Rollback

Database migrations run forward-only. To rollback schema changes:

1. Create a new down migration:
   ```bash
   cd packages/api
   npx drizzle-kit generate --name rollback-<feature>
   ```

2. Apply the rollback migration:
   ```bash
   npm run db:migrate --workspace=@wic/api
   ```

3. Commit and push the rollback migration

## Monitoring Deployments

### GitHub Actions

- View workflow runs: Repository > Actions tab
- Download logs: Click on a workflow run > download logs

### Cloudflare Pages

- Real-time logs: Dashboard > Workers & Pages > jobapp > Functions > Logs
- Analytics: Dashboard > Workers & Pages > jobapp > Analytics

## Troubleshooting

### Build Failures

1. Check the lint step - fix any ESLint errors
2. Check type errors - run `npm run typecheck` locally
3. Check test failures - run `npm run test` locally

### Migration Failures

1. Check the `SUPABASE_DATABASE_URL` secret is correct
2. Verify the database is accessible (not paused on free tier)
3. Review migration SQL for syntax errors
4. Check for conflicting schema changes

### Deployment Failures

1. Verify `CLOUDFLARE_API_TOKEN` has correct permissions
2. Check `CLOUDFLARE_ACCOUNT_ID` matches your account
3. Ensure the Pages project name (`jobapp`) exists
4. Review Cloudflare Pages logs for function errors

### Preview URL Not Posting

1. Check the workflow has `pull-requests: write` permission
2. Verify the deployment step output includes the URL
3. Review the "Comment preview URL" step logs

## Future Enhancements

Once the API is migrated to Cloudflare Pages Functions (see ADR-004):

- [ ] Add API deployment to the workflow
- [ ] Configure R2 bucket bindings
- [ ] Add Cloudflare secrets for API (JWT secret, service keys)
- [ ] Add E2E tests against preview deployments
- [ ] Add production smoke tests after deployment
