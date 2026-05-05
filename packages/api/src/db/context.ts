import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../types/env.js';

const envStorage = new AsyncLocalStorage<Env>();

export function runWithEnv<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  return envStorage.run(env, fn);
}

export function getRequestEnv(): Env | undefined {
  return envStorage.getStore();
}
