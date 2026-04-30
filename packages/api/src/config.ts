export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  dataDir: string;
  nodeEnv: string;
  anthropicApiKey: string | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseJwtSecret: string | null;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    // Trim API key to remove invisible characters (Windows line endings, trailing spaces)
    const rawKey = process.env.ANTHROPIC_API_KEY;
    const cleanKey = rawKey ? rawKey.trim().replace(/^["']|["']$/g, '') : null;

    _config = {
      port: parseInt(process.env.PORT ?? '3000', 10),
      host: process.env.HOST ?? '127.0.0.1',
      databaseUrl: process.env.DATABASE_URL ?? '',
      dataDir: process.env.DATA_DIR ?? './data',
      nodeEnv: process.env.NODE_ENV ?? 'development',
      anthropicApiKey: cleanKey || null,
      supabaseUrl: process.env.SUPABASE_URL ?? null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null,
      supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
    };
  }
  return _config;
}
