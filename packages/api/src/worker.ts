/// <reference types="@cloudflare/workers-types" />
import { buildApp } from './app.js';
import { runWithEnv } from './db/context.js';
import { isHyperdriveTimeout } from './db/hyperdrive.js';
import type { Env } from './types/env.js';

const app = buildApp();

const MAX_HYPERDRIVE_RETRIES = 3;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_HYPERDRIVE_RETRIES; attempt++) {
      try {
        // Each runWithEnv call creates a fresh request context (fresh Hyperdrive
        // connection) so retries don't reuse a potentially broken connection.
        return await runWithEnv(env, () =>
          Promise.resolve(app.fetch(request, env as Record<string, unknown>, ctx))
        );
      } catch (err) {
        if (isHyperdriveTimeout(err) && attempt < MAX_HYPERDRIVE_RETRIES) {
          await new Promise<void>((r) => setTimeout(r, 50 * attempt));
          continue;
        }
        return new Response(
          JSON.stringify({
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Database connection timed out. Please retry.',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '1' } }
        );
      }
    }
    // unreachable
    return new Response('Internal Server Error', { status: 500 });
  },
};
