# ADR-005: GitHub Actions CI/CD Pipeline

## Status

Accepted

## Context

The application needs automated deployment to Cloudflare Pages on merge to main, including:
- Database migrations (Supabase)
- Frontend build and deploy
- Quality gates (lint, test, typecheck)
- Preview deployments for pull requests

Options considered:
1. **GitHub Actions** - Native to GitHub, free for public repos
2. **Cloudflare Pages direct** - Auto-deploy from Git, limited customization
3. **CircleCI/TravisCI** - External CI, additional service to manage

## Decision

Use **GitHub Actions** for CI/CD with Cloudflare Wrangler for deployments.

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions Workflow                          │
│                                                                          │
│  on: push to main OR pull_request to main                               │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      lint-and-test (all events)                   │   │
│  │                                                                    │   │
│  │  1. Checkout code                                                  │   │
│  │  2. Setup Node.js 20 with npm cache                               │   │
│  │  3. npm ci                                                         │   │
│  │  4. npm run lint                                                   │   │
│  │  5. npm run typecheck                                              │   │
│  │  6. npm run format:check                                           │   │
│  │  7. npm run test                                                   │   │
│  │  8. npm run build                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│              ┌───────────────┴───────────────┐                          │
│              ▼                               ▼                          │
│  ┌─────────────────────────┐   ┌─────────────────────────┐              │
│  │  e2e-tests (all)        │   │  deploy-preview (PR)    │              │
│  │                         │   │                         │              │
│  │  - Playwright tests     │   │  - Build with env vars  │              │
│  │  - Multi-user isolation │   │  - wrangler pages deploy│              │
│  │  - Upload report        │   │  - Comment preview URL  │              │
│  └─────────────────────────┘   └─────────────────────────┘              │
│                                              │                           │
│                              ┌───────────────┘                          │
│                              ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              deploy-production (push to main only)                │   │
│  │                                                                    │   │
│  │  environment: production (requires approval if configured)        │   │
│  │  concurrency: production-deploy (no parallel deploys)             │   │
│  │                                                                    │   │
│  │  1. Run database migrations (SUPABASE_DATABASE_URL)               │   │
│  │  2. Build with production env vars                                 │   │
│  │  3. wrangler pages deploy --branch=main                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Job Details

**lint-and-test**: Quality gates that must pass before any deployment
- Runs on every push and PR
- Fails fast on lint/type/format errors
- Unit tests with coverage

**e2e-tests**: End-to-end browser tests
- Playwright with Chromium
- Tests multi-user data isolation
- Uploads HTML report as artifact (14-day retention)

**deploy-preview**: PR preview deployments
- Only runs on pull_request events
- Deploys to branch-specific URL
- Auto-comments preview URL on PR

**deploy-production**: Main branch deployment
- Only runs on push to main
- Uses `environment: production` for secrets isolation
- Concurrency group prevents parallel deploys
- Runs migrations before deploy

### Required Secrets & Variables

**Repository Secrets** (Settings > Secrets):
| Name | Description |
|------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string for migrations |
| `E2E_TEST_USER_EMAIL` | Test user 1 email for E2E tests |
| `E2E_TEST_USER_PASSWORD` | Test user 1 password |
| `E2E_TEST_USER2_EMAIL` | Test user 2 email (isolation tests) |
| `E2E_TEST_USER2_PASSWORD` | Test user 2 password |

**Repository Variables** (Settings > Variables):
| Name | Description |
|------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |

### Rollback Procedure

Cloudflare Pages maintains deployment history:

1. **Via Dashboard**: 
   - Go to Cloudflare Dashboard > Pages > jobapp
   - Click "Deployments" tab
   - Find previous working deployment
   - Click "..." > "Rollback to this deployment"

2. **Via CLI**:
   ```bash
   # List recent deployments
   wrangler pages deployments list --project-name=jobapp
   
   # Promote specific deployment to production
   wrangler pages deployments promote <deployment-id> --project-name=jobapp
   ```

3. **Database Rollback**:
   - Drizzle migrations are forward-only by default
   - For critical rollback: restore from Supabase point-in-time backup
   - Write explicit down migration if schema change is reversible

## Consequences

### Positive

- **Native GitHub integration**: No external service, permissions via GitHub
- **Preview deployments**: Every PR gets testable preview URL
- **Concurrency control**: No accidental parallel production deploys
- **Artifact storage**: Test reports available for debugging
- **Environment isolation**: Production secrets separate from PR builds

### Negative

- **GitHub dependency**: Workflow files in repo, tied to GitHub
- **Minutes usage**: Free tier limits on private repos
- **Migration timing**: DB migrates before deploy (brief inconsistency window)

### Future Enhancements

- Add Slack/Discord notification on deploy success/failure
- Implement blue-green deployment with traffic shifting
- Add performance testing job (Lighthouse CI)
- Database migration dry-run step

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Cloudflare Wrangler Action](https://github.com/cloudflare/wrangler-action)
- [Playwright GitHub Actions](https://playwright.dev/docs/ci-intro)
- WIC-200: CI/CD implementation
- WIC-208: Pipeline enhancements
