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

export interface Env {
  HYPERDRIVE?: { connectionString: string };
  R2_BUCKET?: R2Bucket;
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
