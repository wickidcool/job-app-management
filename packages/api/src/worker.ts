/// <reference types="@cloudflare/workers-types" />
import { buildApp } from './app.js';
import { runWithEnv } from './db/context.js';
import { isHyperdriveTimeout, isSubrequestExhaustion } from './db/hyperdrive.js';
import { tripConnectBreaker } from './db/connect-budget.js';
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
        // A retry costs subrequests we no longer have, and it cannot succeed:
        // the budget does not refill mid-invocation. Answer on the first failure
        // so the response itself still fits in what is left.
        if (isSubrequestExhaustion(err)) {
          // WIC-1916: a general (non-/health) endpoint just drained the budget on
          // the direct-DATABASE_URL path. We are now outside the request's
          // AsyncLocalStorage scope so that pool is unreachable to end here — but
          // trip the isolate breaker so the *next* request in this warm Worker
          // short-circuits at getDb() instead of repeating the drain. Reset happens
          // on the next successful probe (see withConnectBudget).
          tripConnectBreaker('subrequest budget exhausted on direct DB connect');
          return new Response(
            JSON.stringify({
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message:
                  'Database unreachable: the request exhausted its outbound connection budget.',
              },
            }),
            { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } }
          );
        }
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
