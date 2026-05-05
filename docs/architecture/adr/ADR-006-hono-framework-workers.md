# ADR-006: Hono Framework for Cloudflare Workers

## Status

Accepted

## Context

The Job Application Manager backend needs to migrate from Fastify/Node.js to Cloudflare Workers for global edge deployment. We need a web framework that:

1. Runs natively on Cloudflare Workers runtime
2. Provides similar DX to Fastify (routing, middleware, validation)
3. Has TypeScript-first design
4. Supports portable code (can also run on Node.js for local dev/fallback)
5. Has active maintenance and community

### Options Evaluated

| Framework | Workers Native | TypeScript | Middleware | Bundle Size | Maturity |
|-----------|----------------|------------|------------|-------------|----------|
| **Hono** | Yes | First-class | Built-in | ~14KB | High |
| **Itty Router** | Yes | Good | Manual | ~1KB | Medium |
| **Fastify** | No* | Good | Plugin-based | ~150KB | High |
| **Express** | No | Via DefinitelyTyped | Middleware | ~200KB | High |
| **Elysia** | Bun-focused | First-class | Built-in | ~30KB | Medium |

*Fastify can run on Workers with significant adaptation but is not designed for edge runtimes.

## Decision

Use **Hono** as the web framework for the Cloudflare Workers API.

### Why Hono

1. **Native Workers Support**: Zero-config deployment to Cloudflare Workers
2. **Familiar API**: Route definitions mirror Express/Fastify patterns
3. **Type Safety**: Full TypeScript inference for routes, params, body, context
4. **Built-in Middleware**: CORS, JWT, compression, caching, validation
5. **Validator Integration**: First-party `@hono/zod-validator` for Zod schemas
6. **Multi-Runtime**: Same code runs on Workers, Deno, Bun, and Node.js
7. **Small Bundle**: ~14KB gzipped, fast cold starts
8. **Active Development**: Regular releases, responsive maintainers

### Migration Effort

The migration from Fastify to Hono is moderate:

| Aspect | Effort | Notes |
|--------|--------|-------|
| Route handlers | Low | Similar syntax, mechanical conversion |
| Middleware | Low | Hono provides equivalents for all current middleware |
| Validation | Low | Replace Fastify schemas with `@hono/zod-validator` |
| Error handling | Low | `app.onError()` replaces `setErrorHandler` |
| Plugin system | Medium | Refactor Fastify plugins to Hono middleware |
| Request context | Medium | Change from `request.userId` to `c.get('userId')` |
| Response helpers | Low | `reply.send()` → `c.json()` |

### Code Comparison

**Fastify (current)**:
```typescript
fastify.post('/applications', async (request, reply) => {
  const userId = request.userId;
  const body = request.body as CreateDTO;
  const result = await createApplication(body, userId);
  return reply.status(201).send({ data: result });
});
```

**Hono (target)**:
```typescript
app.post('/applications', zValidator('json', createSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const result = await createApplication(c.env, body, userId);
  return c.json({ data: result }, 201);
});
```

### Environment Bindings

Hono provides typed access to Cloudflare bindings:

```typescript
type Env = {
  HYPERDRIVE: Hyperdrive;
  R2_BUCKET: R2Bucket;
  SUPABASE_JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => {
  // c.env is fully typed
  const dbUrl = c.env.HYPERDRIVE.connectionString;
  return c.json({ status: 'ok' });
});
```

## Consequences

### Positive

- **Edge-native performance**: Sub-50ms cold starts globally
- **Type safety**: Compile-time errors for routing, validation, context
- **Portable**: Can run on Node.js with `@hono/node-server` for local dev or rollback
- **Modern patterns**: Async context, streaming responses, WebSocket support
- **Future-proof**: Designed for edge runtimes, not adapted from server frameworks

### Negative

- **Learning curve**: Team needs to learn Hono patterns (minor, given similarity to Express)
- **Ecosystem**: Smaller middleware ecosystem than Express (but growing)
- **Migration work**: All route files need updates (one-time cost)

### Neutral

- **Testing**: Hono has built-in test client; Vitest continues to work
- **Documentation**: Good official docs, but fewer tutorials than Express

## Implementation

See `docs/architecture/CLOUDFLARE_WORKERS_ARCHITECTURE.md` for full migration guide.

### Route Migration Checklist

- [ ] Create Hono app entry point (`src/index.ts`)
- [ ] Migrate auth middleware
- [ ] Migrate CORS middleware
- [ ] Migrate error handler
- [ ] Convert each route file (11 total)
- [ ] Update service layer to accept `env` parameter
- [ ] Configure wrangler.toml
- [ ] Test with `wrangler dev`

## References

- [Hono Documentation](https://hono.dev)
- [Hono GitHub](https://github.com/honojs/hono)
- [Cloudflare Workers + Hono Guide](https://hono.dev/getting-started/cloudflare-workers)
- [Hono Zod Validator](https://hono.dev/guides/validation#with-zod)
- WIC-221: Design Cloudflare Workers architecture
- WIC-222: Implement Fastify to Hono migration
