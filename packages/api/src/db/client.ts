import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../config.js';
import { getRequestContext } from './context.js';
import {
  DbUnreachableError,
  connectBreakerReason,
  isConnectBreakerOpen,
} from './connect-budget.js';

let _db: ReturnType<typeof drizzle> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Connection options for both Workers paths.
 *
 * Every TCP connect postgres-js opens costs one subrequest, and the budget is
 * per-invocation and shared with every other fetch() the request makes. Left at
 * its defaults postgres-js will hold a pool of 10 and re-dial a dead host with
 * backoff and no attempt ceiling, so a database that cannot be reached at all
 * drains the budget before any handler gets to report why — which is how a
 * connect failure turns into an opaque 500 on every endpoint at once, with the
 * failure telemetry swallowed alongside it.
 *
 * `max: 1` makes the request context's "exactly one connection per request"
 * comment true rather than aspirational, and `connect_timeout` bounds how long
 * a single dial can sit on the budget. Together they cap the damage of an
 * unreachable database at one wasted subrequest.
 */
const WORKERS_CONNECTION_OPTIONS = {
  prepare: false,
  max: 1,
  connect_timeout: 5,
} as const;

export function getDb() {
  const ctx = getRequestContext();
  if (ctx?.env?.HYPERDRIVE) {
    // Workers (preview): Hyperdrive handles connection pooling.
    if (!ctx.sql) {
      ctx.sql = postgres(ctx.env.HYPERDRIVE.connectionString, WORKERS_CONNECTION_OPTIONS);
    }
    return drizzle(ctx.sql as ReturnType<typeof postgres>);
  }

  if (ctx?.env?.DATABASE_URL) {
    // Workers (production): direct Supabase connection — one connection per request,
    // reused across service calls within the same request via the context cache.
    //
    // WIC-1916 interim bound: this branch has no Hyperdrive to proxy the connect,
    // so a refusing host would send postgres-js into its ceiling-less initial-dial
    // loop and drain the subrequest budget. If the isolate breaker is open, a
    // recent request already proved the DB unreachable — fail fast here, before
    // opening a single socket, so we neither waste subrequests nor swallow the
    // budget the failure telemetry needs. Removed entirely once prod has a
    // HYPERDRIVE binding (ADR-007 / WIC-1473), which takes the branch above.
    if (isConnectBreakerOpen()) {
      throw new DbUnreachableError(
        `Database unreachable (connect breaker open): ${connectBreakerReason()}`
      );
    }
    if (!ctx.sql) {
      ctx.sql = postgres(ctx.env.DATABASE_URL, {
        ...WORKERS_CONNECTION_OPTIONS,
        ssl: 'require',
      });
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
