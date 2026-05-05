export interface Env {
  HYPERDRIVE?: { connectionString: string };
  R2_BUCKET?: unknown;
  SUPABASE_JWT_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NODE_ENV?: string;
}

export interface HonoVariables {
  userId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: HonoVariables };
