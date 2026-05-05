import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../config.js';

let _db: ReturnType<typeof drizzle> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
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
