import { AppError } from '../types/index.js';
import { getRequestContext } from './context.js';

/**
 * Interim bound on the direct-`DATABASE_URL` Workers path (WIC-1916 / WIC-1386).
 *
 * The definitive fix is a production Hyperdrive binding (ADR-007 / WIC-1473): it
 * removes the direct-dial path in `client.ts` entirely, so this module is dead
 * weight the moment prod carries a `HYPERDRIVE` binding. Until then it caps the
 * damage of an unreachable database, because postgres-js cannot.
 *
 * ## Why postgres-js cannot self-bound this
 *
 * `postgres@3.4.9` (pinned) re-dials a failed *initial* connect with no ceiling
 * and no delay: `src/connection.js` `closed()` does `if (initial) return
 * reconnect()`, and `reconnect()` is `setTimeout(connect, 0)` while `closedTime`
 * is still unset. Under Workers every dial is one subrequest from a
 * per-invocation budget of ~1000 shared with every other `fetch()`, so a
 * database that refuses/closes fast drains the whole budget in seconds — the
 * 8–14s / "Too many subrequests" signature measured in prod.
 *
 * Neither option we already set touches that loop: `max: 1` bounds *pool size*,
 * not a single connection's socket lifecycle; `connect_timeout` bounds a dial
 * that *hangs*, but these dials fail fast so the timer restarts every re-dial
 * and never arms. Critically, the query promise does **not** reject per failed
 * dial — it stays queued as `initial` and only rejects once the budget is
 * exhausted (a synchronous throw from `connect()`), i.e. after ~1000 wasted
 * subrequests. So there is nothing to catch "on first failure"; the only lever
 * is to tear the pool down from outside on a wall-clock bound. `sql.end({
 * timeout: 0 })` terminates the connection, which rejects the pending query with
 * `CONNECTION_DESTROYED` and clears `initial`, so the loop stops after at most
 * one already-scheduled residual dial (verified empirically against a refusing
 * socket: dials climb to 150+/300ms untended, and stop within +1 of `end()`).
 *
 * ## Two layers
 *
 * 1. **Per-op wall-clock teardown** (`withConnectBudget`): races a single DB op
 *    against a timeout and, on timeout *or* failure, ends the request's pool so
 *    the loop cannot keep burning budget after we have already given up on it.
 * 2. **Isolate breaker**: a failure trips a short cooldown during which
 *    `getDb()`'s direct branch (see `client.ts`) throws *before dialing at all*.
 *    A warm isolate that has just watched one request drain its budget will not
 *    let the next N requests each repeat that drain — they fail fast and cheap,
 *    leaving the subrequest the failure telemetry needs. A success resets it.
 *
 * The wall-clock bound is a *bound*, not a one-subrequest guarantee: how many
 * dials fit in the window depends on how fast the host refuses. That guarantee
 * only comes from Hyperdrive removing the direct dial. This buys a fast, clean
 * 503 and a protected isolate in the meantime.
 */

/** Default wall-clock ceiling for a single direct-path DB op, in ms. Chosen to
 * comfortably clear a healthy cross-region direct connect (~50–200ms) while
 * keeping a failing dial-loop well under the ~1000-subrequest budget at the
 * refusal rates observed in prod. */
export const CONNECT_BUDGET_TIMEOUT_MS = 2500;

/** How long the isolate breaker stays open after a direct-path failure. Short so
 * a recovered database is re-probed quickly, long enough to absorb a burst. */
export const CONNECT_BREAKER_COOLDOWN_MS = 10_000;

/** Raised when the direct path is short-circuited by an open breaker, or when a
 * bounded op is torn down. Maps to a clean 503 via `app.onError`'s `AppError`
 * branch rather than an opaque 500. */
export class DbUnreachableError extends AppError {
  constructor(message: string) {
    super('SERVICE_UNAVAILABLE', message, undefined, 503);
    this.name = 'DbUnreachableError';
  }
}

// Isolate-scoped breaker state. Module scope = per V8 isolate = per warm Worker,
// which is exactly the blast radius we want to protect.
let _openUntil = 0;
let _lastReason = '';

/** True while the breaker is open (direct dials should be refused up front). */
export function isConnectBreakerOpen(now: number = Date.now()): boolean {
  return now < _openUntil;
}

export function connectBreakerReason(): string {
  return _lastReason;
}

export function tripConnectBreaker(reason: string, now: number = Date.now()): void {
  _openUntil = now + CONNECT_BREAKER_COOLDOWN_MS;
  _lastReason = reason;
}

/** Close the breaker — call on any successful direct-path op so a recovered DB is
 * served immediately instead of waiting out a stale cooldown. */
export function resetConnectBreaker(): void {
  _openUntil = 0;
  _lastReason = '';
}

/**
 * End the current request's postgres pool (if any) so its ceiling-less reconnect
 * loop stops consuming subrequests, and trip the isolate breaker. Fire-and-forget:
 * `end({ timeout: 0 })` schedules the teardown and rejects the in-flight query; we
 * do not await it (there may be no budget left to close politely) and we swallow
 * its rejection so it never surfaces as an unhandled rejection.
 */
export function teardownRequestPool(reason: string): void {
  const ctx = getRequestContext();
  const sql = ctx?.sql;
  if (ctx) ctx.sql = undefined;
  if (sql) {
    try {
      void Promise.resolve(sql.end({ timeout: 0 })).catch(() => {});
    } catch {
      // end() itself should not throw, but never let teardown mask the original error.
    }
  }
  tripConnectBreaker(reason);
}

/**
 * Run one direct-path DB op under a wall-clock ceiling. On timeout or failure we
 * tear the pool down (stopping the reconnect loop) and trip the breaker; on
 * success we reset it. Hyperdrive-path and Node-path callers do not need this —
 * neither has the ceiling-less-retry-on-a-shared-budget hazard — but it is safe
 * to wrap them (a healthy op resolves far inside the window).
 */
export async function withConnectBudget<T>(
  op: () => Promise<T>,
  timeoutMs: number = CONNECT_BUDGET_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      op(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DbUnreachableError('Database connect budget exceeded')),
          timeoutMs
        );
      }),
    ]);
    resetConnectBreaker();
    return result;
  } catch (err) {
    teardownRequestPool(err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
