import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../types/env.js';

export interface RequestContext {
  env: Env;
  // postgres.Sql instance; lazily set by db/client.ts so each Workers request
  // creates exactly one connection through Hyperdrive regardless of how many
  // times getDb() is called.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql?: any;
  // Set once this request's connect deadline expires. While it is set every
  // getDb() throws immediately instead of building another pool, so a database
  // that cannot be reached costs one bounded burst of dials per invocation
  // rather than one per service call. See db/connect-bound.ts.
  dbUnreachable?: Error;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function runWithEnv<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  return requestStorage.run({ env }, fn);
}

export function getRequestEnv(): Env | undefined {
  return requestStorage.getStore()?.env;
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}
