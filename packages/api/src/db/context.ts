import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../types/env.js';

export interface RequestContext {
  env: Env;
  // postgres.Sql instance; lazily set by db/client.ts so each Workers request
  // creates exactly one connection through Hyperdrive regardless of how many
  // times getDb() is called.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql?: any;
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
