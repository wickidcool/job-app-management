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
}

export interface HonoVariables {
  userId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: HonoVariables };
