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
   * `DEFAULT_CONNECT_DEADLINE_MS`; an unparseable value falls back to it, and
   * so does a **blank** one — `Number('')` is `0`, which is a valid setting
   * here (immediate trip) rather than a rejected one, so blank had to be
   * excluded explicitly. See `resolveConnectDeadlineMs`.
   */
  DB_CONNECT_DEADLINE_MS?: string;
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

  /**
   * The authenticated caller's `email` claim, when the verified token carried one
   * (WIC-2383).
   *
   * Deliberately optional, and deliberately NOT used for authorization. Two paths
   * through `middleware/auth.ts` reach a guarded route without it: the local-dev
   * bypass (no token at all) and a verified token that simply omits `email`, which
   * is legal — `requireSubject` mandates `sub` and nothing else. Identity is
   * `userId`; this is a display attribute, and `/auth/me` reports it as `null`
   * rather than inventing one when it is absent.
   *
   * It exists so `/auth/me` can answer from the token the middleware already
   * verified. The previous implementation called `supabase.auth.admin.getUserById`
   * with the **anon** key, which no deployment can satisfy — this repo provisions
   * no service-role key anywhere — so that call 401'd at GoTrue and the route
   * always 404'd. Do not reintroduce an admin call here to populate this.
   */
  userEmail?: string;
}

export type AppEnv = { Bindings: Env; Variables: HonoVariables };
