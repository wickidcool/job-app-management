# Cloudflare Workers API Architecture

## Executive Summary

This document defines the architecture for migrating the Job Application Manager backend from Fastify/Node.js to Cloudflare Workers. The migration enables global edge deployment while maintaining compatibility with existing Supabase PostgreSQL and R2 storage.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare Edge Network                            │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                   Cloudflare Workers (Hono)                            │  │
│  │                                                                         │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │  │
│  │  │   /api/*    │ │   Auth      │ │  Middleware │ │   Error Handler │  │  │
│  │  │   Routes    │ │  (JWT/jose) │ │  (CORS)     │ │                 │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘  │  │
│  │                                                                         │  │
│  │  Services Layer (Workers-compatible)                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │  │ application.service │ dashboard.service │ catalog.service │ ... │   │  │
│  │  └─────────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                          │                    │                              │
│              ┌───────────┘                    └───────────┐                  │
│              ▼                                            ▼                  │
│  ┌─────────────────────────────┐          ┌─────────────────────────────┐   │
│  │       Hyperdrive            │          │     Cloudflare R2            │   │
│  │   (Connection Pooling)      │          │     (Already configured)     │   │
│  │                             │          │     jobapp-documents/        │   │
│  └──────────────│──────────────┘          └─────────────────────────────┘   │
│                 │                                                            │
└─────────────────│────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Supabase PostgreSQL                                  │
│                         (External, unchanged)                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Technology Decisions

### Framework: Hono

**Decision**: Migrate from Fastify to [Hono](https://hono.dev) for Cloudflare Workers compatibility.

**Rationale**:
- Native Cloudflare Workers support with zero configuration
- Similar API design to Express/Fastify (familiar patterns)
- Built-in middleware: CORS, JWT, validators
- TypeScript-first with excellent type inference
- Minimal bundle size (~14KB)
- Works across all edge runtimes (Workers, Deno, Bun, Node.js)

**Migration Mapping**:

| Fastify | Hono |
|---------|------|
| `fastify.register(plugin)` | `app.use(middleware)` |
| `fastify.get('/path', handler)` | `app.get('/path', handler)` |
| `request.body` | `c.req.json()` |
| `request.params` | `c.req.param('id')` |
| `request.query` | `c.req.query('cursor')` |
| `reply.status(200).send({})` | `c.json({}, 200)` |
| `fastify.decorateRequest()` | `c.set('userId', ...)` |

### Database: Hyperdrive + Drizzle ORM

**Decision**: Use Cloudflare Hyperdrive for PostgreSQL connection pooling with existing Drizzle ORM.

**Architecture**:
```
Worker Request
      │
      ▼
┌─────────────────┐
│   Hyperdrive    │  ← Connection pooling at edge
│   (Cloudflare)  │  ← Caches connections globally
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Supabase Pooler │  ← Transaction mode (port 6543)
│  (PgBouncer)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   PostgreSQL    │
└─────────────────┘
```

**Database Client Changes**:

```typescript
// Current (Node.js)
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);

// Workers (Hyperdrive)
import postgres from 'postgres';
export function getDb(env: Env) {
  const sql = postgres(env.HYPERDRIVE.connectionString);
  return drizzle(sql);
}
```

**Key Changes**:
- Database client created per-request (Workers are stateless)
- Connection string from `env.HYPERDRIVE.connectionString`
- No global singleton pattern (Workers don't persist between requests)

### Storage: R2 Bindings (Direct)

**Current**: AWS SDK S3Client with R2 endpoint
**Target**: Native R2 bindings for better performance

```typescript
// Current (AWS SDK)
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const client = new S3Client({ endpoint: R2_ENDPOINT, ... });
await client.send(new PutObjectCommand({ Bucket, Key, Body }));

// Workers (Native R2 Binding)
export async function uploadObject(env: Env, key: string, body: Buffer) {
  await env.R2_BUCKET.put(key, body);
}

export async function getSignedUrl(env: Env, key: string, expiresIn: number) {
  const object = await env.R2_BUCKET.get(key);
  // For signed URLs, still use presigned URL generation
  // R2 supports this via the API
}
```

**Hybrid Approach**: Keep AWS SDK for presigned URL generation (R2 bindings don't support this directly), use native bindings for uploads/deletes.

## Compatibility Analysis

### Fully Compatible

| Dependency | Notes |
|------------|-------|
| `drizzle-orm` | Works with postgres.js in Workers |
| `jose` | Pure JS, Workers-compatible |
| `zod` | Pure JS, Workers-compatible |
| `ulid` | Pure JS, Workers-compatible |

### Requires Adaptation

| Dependency | Issue | Solution |
|------------|-------|----------|
| `postgres` | Needs Hyperdrive | Use `env.HYPERDRIVE.connectionString` |
| `@aws-sdk/client-s3` | Large bundle | Keep for presigned URLs, use R2 bindings for CRUD |
| `@anthropic-ai/sdk` | Uses fetch, should work | Verify edge runtime support |

### Not Compatible (Requires Alternative)

| Dependency | Issue | Solution |
|------------|-------|----------|
| `pdf-parse` | Uses Node.js `fs`, `Buffer` APIs | Option A: pdf.js port, Option B: Separate parse worker with `nodejs_compat` |
| `mammoth` | Uses Node.js streams/fs | Same as pdf-parse |
| `node:fs` | Not available in Workers | R2 storage only (already migrated for cloud) |
| `node:path` | Limited availability | Use string manipulation or import from `node:path` with `nodejs_compat` |

### PDF/DOCX Parsing Strategy

**Recommended: Dedicated Parser Worker**

Create a separate Worker with `nodejs_compat` flag specifically for document parsing:

```
┌───────────────────────┐     ┌───────────────────────┐
│    Main API Worker    │     │   Parser Worker       │
│    (Standard runtime) │────▶│   (nodejs_compat)     │
│                       │     │                       │
│  • All routes         │     │  • POST /parse/pdf    │
│  • Auth, CRUD         │     │  • POST /parse/docx   │
│  • Calls parser via   │     │  • Returns text/JSON  │
│    service binding    │     │                       │
└───────────────────────┘     └───────────────────────┘
```

**Alternative: Client-Side Parsing**

For PDF, use pdf.js in the browser before upload:
- User uploads file
- Browser extracts text with pdf.js
- API receives `{ file: Buffer, extractedText: string }`

This shifts parsing cost to client but adds complexity.

## Route Migration Pattern

### Before (Fastify)

```typescript
// packages/api/src/routes/applications.ts
export async function applicationsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    const userId = request.userId;
    const apps = await listApplications(userId);
    return reply.send({ data: apps });
  });

  fastify.post('/', async (request, reply) => {
    const userId = request.userId;
    const body = request.body as CreateApplicationDTO;
    const app = await createApplication(body, userId);
    return reply.status(201).send({ data: app });
  });
}
```

### After (Hono)

```typescript
// packages/api/src/routes/applications.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createApplicationSchema } from '../schemas/application.js';

export const applicationsRoutes = new Hono<{ Bindings: Env; Variables: { userId: string } }>()
  .get('/', async (c) => {
    const userId = c.get('userId');
    const db = getDb(c.env);
    const apps = await listApplications(db, userId);
    return c.json({ data: apps });
  })
  .post('/', zValidator('json', createApplicationSchema), async (c) => {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const db = getDb(c.env);
    const app = await createApplication(db, body, userId);
    return c.json({ data: app }, 201);
  });
```

### Key Differences

1. **Environment Bindings**: Access via `c.env` instead of `process.env`
2. **Database Per-Request**: Pass `db` to service functions
3. **Context Variables**: Use `c.get()` / `c.set()` for request-scoped data
4. **Validation**: `@hono/zod-validator` replaces Fastify schema validation
5. **Chained Routes**: Hono supports method chaining for type inference

## Service Layer Changes

Services must accept database instance as parameter:

```typescript
// Before
export async function listApplications(userId?: string) {
  const db = getDb(); // Global singleton
  return db.select().from(applications).where(...);
}

// After
export async function listApplications(
  db: ReturnType<typeof getDb>,
  userId: string
) {
  return db.select().from(applications).where(...);
}
```

## Auth Middleware

```typescript
// packages/api/src/middleware/auth.ts
import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string | null };
}>(async (c, next) => {
  // Skip auth if JWT secret not configured
  if (!c.env.SUPABASE_JWT_SECRET) {
    c.set('userId', null);
    return next();
  }

  const publicPaths = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'];
  if (publicPaths.includes(new URL(c.req.url).pathname)) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const secret = new TextEncoder().encode(c.env.SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    c.set('userId', payload.sub ?? null);
  } catch {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, 401);
  }

  return next();
});
```

## Wrangler Configuration

```toml
# wrangler.toml
name = "jobapp-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
NODE_ENV = "production"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<hyperdrive-config-id>"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "jobapp-documents"

[env.dev]
vars = { NODE_ENV = "development" }

[[env.dev.r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "jobapp-documents-dev"
```

## Environment Types

```typescript
// packages/api/src/types/env.ts
export interface Env {
  // Hyperdrive
  HYPERDRIVE: Hyperdrive;

  // R2
  R2_BUCKET: R2Bucket;

  // Secrets (via wrangler secret)
  SUPABASE_JWT_SECRET: string;
  ANTHROPIC_API_KEY: string;

  // Variables
  NODE_ENV: string;
}
```

## Migration Phases

### Phase 1: Framework Migration (WIC-222)
- Set up Hono app structure
- Migrate all routes from Fastify to Hono
- Update middleware (auth, CORS, error handler)
- Keep Node.js runtime for testing

### Phase 2: Workers Deployment (WIC-223)
- Configure wrangler.toml
- Set up Hyperdrive connection
- Configure R2 bindings
- Deploy to Cloudflare Workers

### Phase 3: Compatibility Fixes
- Address pdf-parse/mammoth incompatibility
- Verify Anthropic SDK edge support
- Performance testing and optimization

## Local Development

```bash
# Start with wrangler dev (uses miniflare)
npm run dev:workers

# Or use local Node.js with Hono (faster iteration)
npm run dev:local
```

Both modes should work with the same codebase using conditional imports or environment detection.

## Testing Strategy

1. **Unit Tests**: Continue using Vitest (works with Hono)
2. **Integration Tests**: Use `wrangler dev` with test database
3. **E2E Tests**: Run against deployed preview environment

## Rollback Plan

The Hono codebase can run on Node.js with `@hono/node-server`:

```typescript
// For emergency rollback to Node.js deployment
import { serve } from '@hono/node-server';
import app from './app.js';

serve({ fetch: app.fetch, port: 3000 });
```

## References

- [Hono Documentation](https://hono.dev)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
- [Cloudflare R2 Bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Workers Node.js Compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- ADR-004: Cloudflare R2 Storage
- ADR-006: Hono Framework Selection (pending)
