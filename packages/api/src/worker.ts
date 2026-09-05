/// <reference types="@cloudflare/workers-types" />
import { buildApp } from './app.js';
import { runWithEnv } from './db/context.js';
import { isDatabaseUnreachable } from './db/connect-bound.js';
import { isHyperdriveTimeout, isSubrequestExhaustion } from './db/hyperdrive.js';
import { runCanary } from './canary.js';
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
        // The connect deadline expired and the pool was torn down. Retrying
        // would re-enter the dial loop the teardown just stopped, on a budget
        // the first burst already spent part of. Answer once.
        if (isDatabaseUnreachable(err)) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database unreachable: no connection could be established.',
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

  // WIC-2127 — Cloudflare Cron Trigger entry point. Fires on the `triggers.crons`
  // schedule in wrangler.jsonc, on a real cadence that the GitHub Actions
  // `schedule` throttling (WIC-2125) does not honour. Runs the production canary
  // (auth + data plane) and files/dedups an incident issue on a failure. It does
  // NOT touch the app's own DB path — the probes go out over the public edge URL,
  // so a red data plane (WIC-2092) cannot stop the canary from reporting it.
  //
  // `ctx.waitUntil` keeps the isolate alive for the async probe+alert work after
  // the handler returns, per the Workers scheduled-handler contract.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCanary(env).catch((err) => {
        // Never let an alert-channel failure crash the scheduled invocation; it
        // is already logged inside runCanary. The Workers dashboard records the
        // rejection for triage without retry-storming the cron.
        console.error(`[canary] scheduled run error: ${(err as Error).message}`);
      })
    );
  },
};
