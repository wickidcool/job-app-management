import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../config.js';
import {
  assertDbReachable,
  createConnectBound,
  resolveConnectDeadlineMs,
} from './connect-bound.js';
import { getRequestContext, type RequestContext } from './context.js';

let _db: ReturnType<typeof drizzle> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Connection options for both Workers paths.
 *
 * Every TCP connect postgres-js opens costs one subrequest, and the budget is
 * per-invocation and shared with every other fetch() the request makes. Left at
 * its defaults postgres-js will hold a pool of 10, so a database that cannot be
 * reached at all drains the budget before any handler gets to report why —
 * which is how a connect failure turns into an opaque 500 on every endpoint at
 * once, with the failure telemetry swallowed alongside it.
 *
 * `max: 1` makes the request context's "exactly one connection per request"
 * comment true rather than aspirational.
 *
 * `connect_timeout` bounds a single dial that *hangs*. It does not bound the
 * initial-connect retry loop, and neither does `max`: that loop lives inside one
 * Connection's socket lifecycle, and it cancels and re-arms the connect timer on
 * every iteration, so the timer can never fire while dials keep failing fast.
 * An earlier revision of this comment claimed these two options "cap the damage
 * of an unreachable database at one wasted subrequest". Production disproved it
 * on every request. The loop is bounded by `connect-bound.ts` instead, which
 * documents the mechanism in full; these options are kept for the cases they do
 * cover.
 */
const WORKERS_CONNECTION_OPTIONS = {
  prepare: false,
  max: 1,
  connect_timeout: 5,
} as const;

/**
 * Build a Workers pool with the connect deadline already armed. Both Workers
 * branches go through here — the Hyperdrive path runs the same postgres-js
 * dial loop as the direct path and is only healthy because its host answers.
 */
function createWorkersPool(
  ctx: RequestContext,
  connectionString: string,
  extra: Record<string, unknown> = {}
): ReturnType<typeof postgres> {
  const bound = createConnectBound(ctx, resolveConnectDeadlineMs(ctx.env?.DB_CONNECT_DEADLINE_MS));
  const sql = postgres(connectionString, {
    ...WORKERS_CONNECTION_OPTIONS,
    ...extra,
    ...bound.options,
  });
  bound.arm(sql);
  return sql;
}

export function getDb() {
  const ctx = getRequestContext();
  if (ctx?.env?.HYPERDRIVE) {
    // Workers (preview): Hyperdrive handles connection pooling.
    assertDbReachable(ctx);
    if (!ctx.sql) {
      ctx.sql = createWorkersPool(ctx, ctx.env.HYPERDRIVE.connectionString);
    }
    return drizzle(ctx.sql as ReturnType<typeof postgres>);
  }

  if (ctx?.env?.DATABASE_URL) {
    // Workers (production): direct Supabase connection — one connection per request,
    // reused across service calls within the same request via the context cache.
    assertDbReachable(ctx);
    if (!ctx.sql) {
      ctx.sql = createWorkersPool(ctx, ctx.env.DATABASE_URL, { ssl: 'require' });
    }
    return drizzle(ctx.sql as ReturnType<typeof postgres>);
  }

  // Node.js path: singleton
  if (!_db) {
    const config = getConfig();
    // Supabase connection strings use sslmode=require; postgres-js needs ssl:true.
    // For local Docker the DATABASE_URL won't have ssl params, so this is a no-op.
    const isSupabase =
      config.databaseUrl.includes('supabase.co') ||
      config.databaseUrl.includes('pooler.supabase.com');
    _sql = postgres(config.databaseUrl, {
      ssl: isSupabase ? 'require' : false,
      max: isSupabase ? 10 : 5,
    });
    _db = drizzle(_sql);
  }
  return _db;
}

export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
  }
}
