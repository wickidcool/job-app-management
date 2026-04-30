# ADR-004: Cloud Migration with Supabase and Cloudflare

**Status**: Proposed  
**Date**: 2026-04-30  
**Deciders**: Architecture Team  
**Related**: [WIC-195](/WIC/issues/WIC-195), [WIC-193](/WIC/issues/WIC-193)

## Context

The Job Application Manager is currently a local-first, single-user application running entirely on the user's machine. To enable multi-user access and provide a hosted SaaS offering, we need to migrate to a cloud architecture while maintaining:

- Data model compatibility with existing features
- Development experience parity (local dev must still work)
- Cost efficiency for a side-project/bootstrapped product
- Security and privacy of user data

## Decision

We will migrate to a cloud architecture using:

| Component | Current | Cloud |
|-----------|---------|-------|
| **Database** | PostgreSQL (Docker) | Supabase PostgreSQL |
| **Authentication** | None (single-user) | Supabase Auth |
| **File Storage** | Local filesystem (`./data/`) | Cloudflare R2 |
| **API Hosting** | Node.js/Fastify (localhost:3000) | Cloudflare Pages Functions |
| **Web Hosting** | Vite dev server (localhost:5173) | Cloudflare Pages |
| **CI/CD** | Manual | GitHub Actions |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Production Environment                             │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Cloudflare Pages                                  │   │
│   │            https://jobapp.pages.dev                                  │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │                  React SPA (Static)                          │   │   │
│   │   │   - Vite build output                                        │   │   │
│   │   │   - Client-side routing                                      │   │   │
│   │   │   - Supabase Auth UI components                              │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                              │                                       │   │
│   │                              │ /api/* requests                       │   │
│   │                              ▼                                       │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │              Pages Functions (Edge Workers)                  │   │   │
│   │   │   /functions/api/[...path].ts                                │   │   │
│   │   │   - Hono router (Fastify-like DX)                            │   │   │
│   │   │   - JWT validation via Supabase                              │   │   │
│   │   │   - User-scoped queries                                      │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                          │                    │                              │
│              ┌───────────┘                    └───────────┐                  │
│              ▼                                            ▼                  │
│   ┌─────────────────────────────┐          ┌─────────────────────────────┐  │
│   │        Supabase              │          │      Cloudflare R2          │  │
│   │   (Managed PostgreSQL)       │          │    (Object Storage)         │  │
│   │                              │          │                             │  │
│   │   - applications             │          │   jobapp-files/             │  │
│   │   - status_history           │          │   ├── {user_id}/            │  │
│   │   - resumes                  │          │   │   ├── resumes/          │  │
│   │   - cover_letters            │          │   │   ├── exports/          │  │
│   │   - catalog tables           │          │   │   └── avatars/          │  │
│   │   - (all with user_id FK)    │          │   └── shared/               │  │
│   │                              │          │       └── templates/        │  │
│   │   + Supabase Auth            │          │                             │  │
│   │   - auth.users               │          │   Access via presigned URLs │  │
│   │   - RLS policies             │          │   or Workers binding        │  │
│   └─────────────────────────────┘          └─────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Detailed Design

### 1. Database Migration (Supabase PostgreSQL)

**Multi-tenancy Model**: Row-Level Security (RLS) with `user_id` on all data tables.

**Schema Changes**:

```sql
-- Add user_id to all existing tables
ALTER TABLE applications ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE status_history ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE resumes ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE resume_exports ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE projects ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE company_catalog ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE job_fit_tags ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE tech_stack_tags ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE quantified_bullets ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE recurring_themes ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE catalog_change_log ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE catalog_diffs ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE wikilink_registry ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE cover_letters ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE outreach_messages ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE resume_variants ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE interview_preps ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE interview_prep_stories ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
ALTER TABLE prep_question_story_links ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);

-- Create indexes for user_id queries
CREATE INDEX idx_applications_user ON applications(user_id);
CREATE INDEX idx_resumes_user ON resumes(user_id);
-- ... (similar indexes for all tables)

-- Enable RLS
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
-- ... (similar for all tables)

-- RLS policies (example)
CREATE POLICY "Users can view own applications"
  ON applications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own applications"
  ON applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own applications"
  ON applications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own applications"
  ON applications FOR DELETE
  USING (auth.uid() = user_id);
```

**Connection Strategy**:
- Use Supabase connection pooler (PgBouncer) for Workers compatibility
- Connection string: `postgres://[user]:[password]@[project].pooler.supabase.com:6543/postgres`
- Use `?pgbouncer=true` for transaction mode

### 2. Authentication (Supabase Auth)

**Auth Flow**:

```
┌────────────┐     ┌────────────────┐     ┌─────────────────┐
│   Client   │────▶│  Supabase Auth │────▶│  Pages Function │
│   (React)  │◀────│  (OAuth/Email) │◀────│  (JWT Verify)   │
└────────────┘     └────────────────┘     └─────────────────┘
```

**Providers** (initial):
- Email/Password (with email confirmation)
- Google OAuth
- GitHub OAuth (developer-friendly)

**Token Handling**:
- Access tokens stored in memory (not localStorage)
- Refresh tokens in httpOnly cookies
- Server-side JWT validation in Pages Functions

**Frontend Integration**:

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Auth state hook
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );

    return () => subscription.unsubscribe();
  }, []);

  return { user, signIn, signOut };
}
```

### 3. File Storage (Cloudflare R2)

**Bucket Structure**:

```
jobapp-files/
├── {user_id}/
│   ├── resumes/
│   │   ├── {resume_id}/
│   │   │   ├── original.pdf
│   │   │   └── parsed.json
│   │   └── ...
│   ├── exports/
│   │   ├── resume-variants/
│   │   │   └── {variant_id}.pdf
│   │   ├── cover-letters/
│   │   │   └── {letter_id}.docx
│   │   └── interview-preps/
│   │       └── {prep_id}.pdf
│   └── avatars/
│       └── profile.jpg
└── shared/
    └── templates/
        ├── resume-modern.docx
        └── cover-letter-classic.docx
```

**Access Patterns**:

| Operation | Method |
|-----------|--------|
| Upload resume | Presigned POST URL (client-direct) |
| Download resume | Presigned GET URL (time-limited) |
| Export generation | Worker → R2 binding (server-side) |
| Template access | Public bucket prefix |

**R2 Configuration**:

```typescript
// wrangler.toml
[[r2_buckets]]
binding = "FILES"
bucket_name = "jobapp-files"
preview_bucket_name = "jobapp-files-preview"

// In Pages Function
export async function onRequest(context) {
  const { FILES } = context.env;
  
  // Upload
  await FILES.put(key, body, {
    httpMetadata: { contentType: 'application/pdf' }
  });
  
  // Generate presigned URL (via S3-compatible API)
  const signedUrl = await getPresignedUrl(key, 3600);
}
```

### 4. API Layer (Cloudflare Pages Functions)

**Migration from Fastify to Hono**:

Hono provides a similar DX to Fastify while being edge-native:

```typescript
// functions/api/[[path]].ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { zValidator } from '@hono/zod-validator';

const app = new Hono();

// Middleware
app.use('*', cors({ origin: ['https://jobapp.pages.dev'] }));
app.use('*', jwt({ secret: env.SUPABASE_JWT_SECRET }));

// User context middleware
app.use('*', async (c, next) => {
  const payload = c.get('jwtPayload');
  c.set('userId', payload.sub);
  await next();
});

// Routes
app.get('/api/applications', zValidator('query', listSchema), async (c) => {
  const userId = c.get('userId');
  const db = createDrizzleClient(c.env.DATABASE_URL);
  
  const apps = await db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .limit(50);
    
  return c.json({ applications: apps });
});

export const onRequest = app.fetch;
```

**Route Mapping**:

| Fastify Route | Pages Function Path |
|---------------|---------------------|
| `GET /api/applications` | `functions/api/applications/index.ts` |
| `GET /api/applications/:id` | `functions/api/applications/[id].ts` |
| `POST /api/applications/:id/status` | `functions/api/applications/[id]/status.ts` |
| `GET /api/dashboard` | `functions/api/dashboard.ts` |

### 5. Frontend Hosting (Cloudflare Pages)

**Build Configuration**:

```toml
# wrangler.toml (or pages dashboard)
[build]
command = "npm run build"
output_directory = "packages/web/dist"

[env.production]
VITE_SUPABASE_URL = "https://xxx.supabase.co"
VITE_SUPABASE_ANON_KEY = "eyJ..."
VITE_API_URL = ""  # Same origin, use /api

[env.preview]
VITE_SUPABASE_URL = "https://xxx.supabase.co"
VITE_SUPABASE_ANON_KEY = "eyJ..."
```

**SPA Routing**:

```typescript
// functions/_middleware.ts
export async function onRequest(context) {
  const url = new URL(context.request.url);
  
  // API requests go to functions
  if (url.pathname.startsWith('/api')) {
    return context.next();
  }
  
  // Serve index.html for SPA routes
  return context.env.ASSETS.fetch(
    new Request(new URL('/index.html', url))
  );
}
```

### 6. CI/CD (GitHub Actions)

**Workflow Design**:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build

  deploy-preview:
    needs: lint-and-test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Deploy to Cloudflare Pages (Preview)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy packages/web/dist --project-name=jobapp

  deploy-production:
    needs: lint-and-test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Database Migrations
        env:
          DATABASE_URL: ${{ secrets.SUPABASE_DATABASE_URL }}
        run: npm run db:migrate --workspace=@wic/api
      - name: Deploy to Cloudflare Pages (Production)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy packages/web/dist --project-name=jobapp --branch=main
```

### 7. Environment & Secrets Management

**Environment Variables by Context**:

| Variable | Local Dev | Preview | Production |
|----------|-----------|---------|------------|
| `DATABASE_URL` | `.env.local` | Cloudflare secret | Cloudflare secret |
| `SUPABASE_URL` | `.env.local` | Cloudflare env | Cloudflare env |
| `SUPABASE_ANON_KEY` | `.env.local` | Cloudflare env | Cloudflare env |
| `SUPABASE_SERVICE_KEY` | `.env.local` | Cloudflare secret | Cloudflare secret |
| `SUPABASE_JWT_SECRET` | `.env.local` | Cloudflare secret | Cloudflare secret |
| `R2_ACCESS_KEY_ID` | `.env.local` | Cloudflare secret | Cloudflare secret |
| `R2_SECRET_ACCESS_KEY` | `.env.local` | Cloudflare secret | Cloudflare secret |

**Secrets Storage**:

```bash
# Set production secrets via Wrangler
wrangler pages secret put DATABASE_URL --project-name=jobapp
wrangler pages secret put SUPABASE_SERVICE_KEY --project-name=jobapp
wrangler pages secret put SUPABASE_JWT_SECRET --project-name=jobapp

# GitHub secrets for CI
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set SUPABASE_DATABASE_URL
```

**Local Development**:

```bash
# packages/api/.env.local (gitignored)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/job_app_manager
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJ...local
SUPABASE_SERVICE_KEY=eyJ...local
DATA_DIR=./data
```

For local Supabase development:

```bash
# Start local Supabase
npx supabase start

# Or use Docker PostgreSQL fallback
docker compose up -d postgres
```

## Consequences

### Positive

- **Multi-user ready**: User isolation via RLS is robust and scalable
- **Edge performance**: Cloudflare's global network reduces latency
- **Cost efficient**: Supabase free tier + Cloudflare free tier covers early growth
- **Managed infrastructure**: No server maintenance, automatic scaling
- **Developer experience**: Local dev still works with Docker or Supabase CLI

### Negative

- **Vendor lock-in**: Tied to Supabase (PostgreSQL is portable) and Cloudflare (Workers have quirks)
- **Cold starts**: Pages Functions have minimal cold start, but still nonzero
- **Migration complexity**: Schema changes require careful RLS policy updates
- **File handling**: R2 presigned URLs add complexity vs. simple filesystem

### Neutral

- **API rewrite**: Fastify → Hono is straightforward but requires testing
- **Auth integration**: Adds login UX complexity but standard patterns exist

## Migration Plan

### Phase 1: Schema Preparation (Week 1)
1. Add `user_id` columns to all tables (nullable initially)
2. Create migration for local testing
3. Set up Supabase project and local CLI

### Phase 2: Auth Integration (Week 2)
1. Add Supabase Auth to frontend
2. Create auth context and protected routes
3. Test login/logout/session flows

### Phase 3: API Migration (Weeks 3-4)
1. Create Hono-based Pages Functions structure
2. Port routes one-by-one with user scoping
3. Add RLS policies to Supabase

### Phase 4: Storage Migration (Week 5)
1. Set up R2 bucket with proper structure
2. Migrate file upload/download to presigned URLs
3. Port export generation to Workers

### Phase 5: CI/CD & Production (Week 6)
1. Set up GitHub Actions workflows
2. Configure Cloudflare Pages project
3. Production deployment and smoke testing

## References

- [Supabase Documentation](https://supabase.com/docs)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Hono Framework](https://hono.dev/)
- [GitHub Actions for Cloudflare](https://github.com/cloudflare/wrangler-action)
