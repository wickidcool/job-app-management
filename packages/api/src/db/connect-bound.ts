import type { RequestContext } from './context.js';

/**
 * A bound on postgres-js's *initial* connect loop, imposed from outside the
 * driver because the driver exposes no option that bounds it.
 *
 * ## The loop
 *
 * `postgres@3.4.9` `src/connection.js:441-458` — when a socket closes, `closed()`
 * checks whether the connection is still in its initial phase:
 *
 * ```js
 * if (initial)
 *   return reconnect()          // -> setTimeout(connect, 0)
 * ```
 *
 * On that path there is no backoff (`closedTime` is still 0, so the delay term
 * is `Math.max(0, 0 + delay - now)` = 0), no attempt ceiling, and the query is
 * never rejected. The backoff bookkeeping below the `return` is unreachable
 * here. Every iteration opens a socket, and on Workers every socket costs one
 * subrequest from a per-invocation budget of 1000.
 *
 * The loop needs a close that arrives *without* an accompanying `error` event —
 * an `error` would reach `errored()` (`:390-394`), which nulls `initial` and
 * ends the loop after a single dial. That is exactly what the Cloudflare socket
 * polyfill produces (`postgres/cf/polyfills.js`):
 *
 * ```js
 * tcp.raw.closed.then(
 *   () => (tcp.readyState !== 'upgrade' ? close() : ...),   // emits 'close' only
 *   (e) => tcp.emit('error', e)
 * )
 * ```
 *
 * A host that accepts and immediately closes therefore re-dials until the
 * subrequest budget is gone, and the caller's first sight of trouble is
 * `Too many subrequests by single Worker invocation` several seconds later.
 * Measured locally against this exact socket shape: **878 dials in one second,
 * with the query still unsettled.**
 *
 * ## Why the existing options do not bound it
 *
 * - `max: 1` bounds the *pool*. The loop lives inside one `Connection` object's
 *   socket lifecycle, which pool size never reaches.
 * - `connect_timeout: 5` bounds a dial that *hangs*. `closed()` calls
 *   `connectTimer.cancel()` and `connect()` calls `connectTimer.start()`, so the
 *   timer is torn down and re-armed on every iteration. It cannot fire while
 *   closes keep arriving faster than the timeout — which is precisely the
 *   failing case. (If it ever did fire, `connectTimedOut()` calls `errored()`
 *   and the loop would stop; that is why the timeout looks like a bound.)
 * - `backoff` is only consulted on the non-initial path, below the `return`.
 * - `socket` is the only per-dial hook, and supplying it makes `connect()` skip
 *   `socket.connect()` entirely (`:335-357`), so the factory must return an
 *   already-connected socket. On Workers that means reimplementing the
 *   `cloudflare:sockets` shim including the TLS upgrade, which is not a safe
 *   trade for a mitigation.
 *
 * ## What this module does instead
 *
 * Ending the pool *does* stop the loop: `end({ timeout: 0 })` reaches
 * `terminate()`, which calls `error(CONNECTION_DESTROYED)` and so nulls
 * `initial`. The next close then falls through to the ordinary close path
 * instead of `return reconnect()`. Measured: dials stop within one further
 * iteration and the caller's query rejects.
 *
 * So we arm a deadline when the pool is created and disarm it on the earliest
 * proof that the dial loop is over, then tear the pool down and open a circuit
 * on the request context so nothing in the same invocation re-enters the loop.
 *
 * ## Honest limits
 *
 * The dial count is bounded by the deadline, not fixed at one — with no per-dial
 * hook, nothing outside the driver can count dials. At the observed rate this
 * turns "~1000 dials, budget gone, opaque failure" into "one bounded burst per
 * invocation, then a typed error", which is the blast-radius reduction the
 * mitigation is for, not a claim that a single dial is guaranteed.
 */

export const DB_UNREACHABLE_MSG = 'Database unreachable: no connection could be established';

export class DatabaseUnreachableError extends Error {
  constructor(public readonly detail: string) {
    super(`${DB_UNREACHABLE_MSG} (${detail})`);
    this.name = 'DatabaseUnreachableError';
  }
}

/**
 * True for both halves of the failure: the error this module raises, and the
 * `CONNECTION_DESTROYED` postgres-js raises for a query that was in flight when
 * the teardown ran. Both are availability failures, not route bugs.
 */
export function isDatabaseUnreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes(DB_UNREACHABLE_MSG)) return true;
  return (err as { code?: unknown }).code === 'CONNECTION_DESTROYED';
}

/**
 * Long enough that an ordinary cold Workers connect (tens to low hundreds of
 * milliseconds, through Hyperdrive or direct) is never cut short, short enough
 * that a refusing host spends a fraction of the 1000-subrequest budget instead
 * of all of it.
 */
export const DEFAULT_CONNECT_DEADLINE_MS = 1500;

export function resolveConnectDeadlineMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CONNECT_DEADLINE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CONNECT_DEADLINE_MS;
}

/** The slice of a postgres-js pool this module needs. */
export interface EndablePool {
  end(options: { timeout: number }): Promise<unknown>;
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: never) => void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export interface ConnectBound {
  /** Spread into the `postgres()` options so the deadline can be disarmed. */
  readonly options: { onparameter: (key: string, value: string) => void };
  /** Arm the deadline against a freshly created pool. */
  arm(sql: EndablePool): void;
  /** Disarm without tripping — used when the request context is torn down. */
  disarm(): void;
}

export function createConnectBound(
  ctx: RequestContext,
  deadlineMs: number,
  timers: Timers = realTimers
): ConnectBound {
  let handle: unknown;
  let settled = false;

  function disarm(): void {
    settled = true;
    if (handle !== undefined) {
      timers.clearTimeout(handle as never);
      handle = undefined;
    }
  }

  return {
    options: {
      // ParameterStatus messages only arrive after a TCP connect *and* a
      // completed startup handshake, so the first one is the earliest proof
      // available to us that the dial loop is over. postgres-js suppresses
      // repeats via `options.parameters`, but that map is per-pool and each
      // Workers request builds a fresh pool, so the first connection always
      // reports. See `connection.js:526-533`.
      onparameter: () => disarm(),
    },

    arm(sql: EndablePool): void {
      if (settled) return;
      handle = timers.setTimeout(() => {
        handle = undefined;
        if (settled) return;
        settled = true;
        tripDbCircuit(ctx, sql, `no connection within ${deadlineMs}ms`);
      }, deadlineMs);
    },

    disarm,
  };
}

/**
 * Open the per-request circuit and tear the pool down. The teardown is the part
 * that stops the dial loop; rejecting the caller alone would leave it running
 * for the rest of the invocation.
 */
export function tripDbCircuit(ctx: RequestContext, sql: EndablePool, detail: string): void {
  if (!ctx.dbUnreachable) {
    ctx.dbUnreachable = new DatabaseUnreachableError(detail);
  }
  // Drop the dead pool so no later getDb() in this request hands it out. The
  // circuit check runs first, so nothing rebuilds one either.
  ctx.sql = undefined;
  void Promise.resolve(sql.end({ timeout: 0 })).catch(() => {
    /* teardown is best-effort; the circuit is already open */
  });
}

/** Fail fast for every later getDb() in a request whose circuit has tripped. */
export function assertDbReachable(ctx: RequestContext): void {
  if (ctx.dbUnreachable) throw ctx.dbUnreachable;
}
