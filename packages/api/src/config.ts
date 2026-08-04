export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  dataDir: string;
  nodeEnv: string;
  anthropicApiKey: string | null;
  llmModel: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseJwtSecret: string | null;
  r2Endpoint: string | null;
  r2AccessKeyId: string | null;
  r2SecretAccessKey: string | null;
  r2Bucket: string | null;
  analyticsSink: 'noop' | 'console' | 'posthog';
  posthogApiKey: string | null;
  posthogHost: string;
}

function normalizeAnalyticsSink(raw: string | undefined): Config['analyticsSink'] {
  const value = raw?.trim().toLowerCase();
  if (value === 'posthog' || value === 'console' || value === 'noop') return value;
  return 'noop';
}

let _config: Config | null = null;

export function _resetConfig(): void {
  _config = null;
}

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
      llmModel: process.env.LLM_MODEL ?? 'claude-sonnet-4-6',
      supabaseUrl: process.env.SUPABASE_URL ?? null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null,
      supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
      r2Endpoint: process.env.R2_ENDPOINT ?? null,
      r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? null,
      r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? null,
      r2Bucket: process.env.R2_BUCKET ?? null,
      analyticsSink: normalizeAnalyticsSink(process.env.ANALYTICS_SINK),
      posthogApiKey: process.env.POSTHOG_API_KEY?.trim() || null,
      posthogHost: process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
    };
  }
  return _config;
}
