/// <reference types="@cloudflare/workers-types" />
import { buildApp } from './app.js';
import { runWithEnv } from './db/context.js';
import type { Env } from './types/env.js';

const app = buildApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return runWithEnv(env, () =>
      Promise.resolve(app.fetch(request, env as Record<string, unknown>, ctx))
    );
  },
};
