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
  localDevUserId: string;
}

/**
 * ADR-010 D3 — the owner the auth bypass supplies in local dev.
 *
 * This is the placeholder `migrations/0017_enforce_userid_not_null.sql` backfills
 * every pre-tenancy `user_id` to before setting the column `NOT NULL`, so local
 * dev queries as a tenant that genuinely owns the legacy rows rather than as an
 * absence. The two must not drift, and the literal here is not the guarantee —
 * `test/local-dev-owner.test.ts` parses the sentinel back out of that migration
 * and asserts equality, so a change to either side fails the suite.
 *
 * Note this is a `string`, not `string | null`: D3 retires the owner-absent
 * affordance ADR-003 left open, and the whole point is that there is no
 * configuration in which the bypass yields "no tenant".
 */
export const LOCAL_DEV_USER_ID_DEFAULT = '00000000-0000-0000-0000-000000000000';

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
      // WIC-2191 — `||`, not `??`, on the two that gate `middleware/auth.ts`'s
      // local-dev bypass: a blank env var must resolve to `null` rather than to
      // `''`, so the declared `string | null` is honest and "unset" has exactly
      // one representation on the fallback side of every `c.env?.X ?? getConfig().x`
      // call site. Not `?.trim()` — see the note at `middleware/auth.ts:57`;
      // whitespace-only must stay truthy (fail-closed), and `supabaseJwtSecret`
      // is HS256 key material that must pass through byte-for-byte.
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null,
      supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || null,
      r2Endpoint: process.env.R2_ENDPOINT ?? null,
      r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? null,
      r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? null,
      r2Bucket: process.env.R2_BUCKET ?? null,
      analyticsSink: normalizeAnalyticsSink(process.env.ANALYTICS_SINK),
      posthogApiKey: process.env.POSTHOG_API_KEY?.trim() || null,
      posthogHost: process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
      // `||` rather than `??` on purpose: an empty or whitespace-only
      // `LOCAL_DEV_USER_ID` must fall back to the sentinel, not resolve to `''`.
      // The empty string is falsy and `requireOwner` rejects it explicitly, so
      // `??` here would turn a blank env var into a 401 on every dev request —
      // reintroducing the owner-absent outcome D3 exists to remove.
      localDevUserId: process.env.LOCAL_DEV_USER_ID?.trim() || LOCAL_DEV_USER_ID_DEFAULT,
    };
  }
  return _config;
}
