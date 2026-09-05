export interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  etag: string;
  httpEtag: string;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<R2Objects>;
  head(key: string): Promise<R2Object | null>;
}

/** Cloudflare static-assets binding (`assets.binding` in wrangler.jsonc). */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS?: AssetsBinding;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  R2_BUCKET?: R2Bucket;
  SUPABASE_JWT_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NODE_ENV?: string;
  /** Opt in to trusting `x-forwarded-proto` for the HTTPS redirect (WIC-1011). */
  TRUST_PROXY_PROTO?: string;
  /**
   * The owner the auth bypass supplies in local dev (ADR-010 D3). Read only on
   * the bypass path, so it has no effect on a deployment with Supabase
   * configured. Defaults to the migration `0017` sentinel — see
   * `LOCAL_DEV_USER_ID_DEFAULT` in `config.ts`.
   */
  LOCAL_DEV_USER_ID?: string;
  /**
   * Milliseconds a Workers request will wait for a database connection before
   * tearing the pool down and failing fast (WIC-2043). Defaults to
   * `DEFAULT_CONNECT_DEADLINE_MS`; an unparseable value falls back to it.
   */
  DB_CONNECT_DEADLINE_MS?: string;
  /**
   * WIC-2127 prod-canary Cron Trigger config. All optional: with none set the
   * scheduled handler still probes and logs, but files no incident (mode "none").
   * `CANARY_GITHUB_TOKEN` is a human-provisioned secret; the rest are non-secret
   * vars with sane defaults (see `canary.ts`).
   */
  CANARY_PROD_BASE_URL?: string;
  CANARY_ALERT_MODE?: string;
  CANARY_GITHUB_TOKEN?: string;
  CANARY_GITHUB_REPO?: string;
  CANARY_WORKFLOW_FILE?: string;
  CANARY_WORKFLOW_REF?: string;
}

export interface HonoVariables {
  /**
   * The authenticated caller's id (ADR-010 D1.2).
   *
   * Declared `string`, not `string | null`: after D1.1 (`requireSubject`) and D3
   * (the local-dev bypass supplies a real owner), no path through
   * `middleware/auth.ts` reaches a guarded route with an absent owner. Narrowing
   * it is what makes the compiler reject a reintroduced
   * `c.get('userId') ?? undefined` — the laundering D1.3 deleted at 66 sites.
   *
   * One caveat this type cannot express: the three `PUBLIC_PATHS` routes run
   * *before* an owner exists, so `authMiddleware` leaves the variable unset and
   * `c.get('userId')` is `undefined` there at runtime despite this declaration.
   * That is why `requireOwner` re-checks at runtime rather than trusting the
   * type, and why `routes/auth.ts` and `routes/onboarding.ts` keep their
   * `if (!userId)` guards (AC-5) — a truthiness test stays legal and stays
   * correct under this narrowing.
   */
  userId: string;
}

export type AppEnv = { Bindings: Env; Variables: HonoVariables };
