import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../config.js';
import { getRequestContext } from './context.js';

let _db: ReturnType<typeof drizzle> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  const ctx = getRequestContext();
  if (ctx?.env?.HYPERDRIVE) {
    // Workers (preview): Hyperdrive handles connection pooling.
    if (!ctx.sql) {
      ctx.sql = postgres(ctx.env.HYPERDRIVE.connectionString, { prepare: false });
    }
    return drizzle(ctx.sql as ReturnType<typeof postgres>);
  }

  if (ctx?.env?.DATABASE_URL) {
    // Workers (production): direct Supabase connection — one connection per request,
    // reused across service calls within the same request via the context cache.
    if (!ctx.sql) {
      ctx.sql = postgres(ctx.env.DATABASE_URL, { prepare: false, ssl: 'require' });
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
