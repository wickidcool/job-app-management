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
 * The endpoint postgres-js names in a connection error, read from the structured
 * fields rather than parsed back out of the message.
 *
 * `Errors.connection` (`postgres/src/errors.js:17-28`) builds the message as
 * `write <CODE> <host>:<port>` and attaches `address` (the host, or the unix
 * socket path) and — for TCP only — `port`. Reading the fields keeps this
 * independent of that message format.
 *
 * ⚠️ `address` and `port` are **arrays**, not strings: postgres-js parses the
 * connection string into `host: ['h']` / `port: [5432]` to support multi-host
 * failover, and `Errors.connection` assigns them through unchanged. It renders
 * them with `host + ':' + port`, and a single-element array stringifies without
 * brackets, which is why the message reads cleanly and hides the array. A
 * `typeof x === 'string'` guard therefore rejects every real postgres-js error
 * and silently drops the endpoint. Mirror the driver's own coercion instead.
 */
function endpointOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { address, port } = err as { address?: unknown; port?: unknown };
  const host = stringifyEndpointPart(address);
  if (host === undefined) return undefined;
  // A unix-socket error carries `address` (the path) and no `port`.
  const suffix = stringifyEndpointPart(port);
  return suffix === undefined ? host : `${host}:${suffix}`;
}

/** Coerce postgres-js's array-or-scalar endpoint fields the way the driver does. */
function stringifyEndpointPart(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    // `String(['a','b'])` is `'a,b'`, exactly what the driver's own message shows.
    return value.length > 0 ? String(value) : undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
}

/**
 * Name the *cause* of a database failure for an operator-facing surface.
 *
 * The two failures are indistinguishable from the caught error alone, and the
 * one that reaches a reader is the misleading one. When the connect deadline
 * expires, `tripDbCircuit` tears the pool down, and postgres-js `terminate()`
 * (`connection.js:425`) rejects the query that was in flight with
 * `write CONNECTION_DESTROYED <host>:<port>`. That string reads as "the far end
 * dropped us" while the truth is "we did not finish TCP + TLS + the Postgres
 * startup handshake inside our own deadline" — a statement about our egress,
 * carrying no information about the server. Reported verbatim it points every
 * reader upstream, which is the one place the fault is not (WIC-2163/WIC-2092).
 *
 * The circuit already knows: `ctx.dbUnreachable` is set *synchronously* in
 * `tripDbCircuit` before `sql.end()` is called, so it is always populated by the
 * time the destroyed query rejects. Its presence is an exact signal — the
 * watchdog at `createConnectBound`'s `arm()` is the only caller.
 *
 * A genuine server-side disconnect leaves `ctx.dbUnreachable` unset and so keeps
 * its own message, which is what distinguishes the two.
 */
export function describeDbFailure(err: unknown, ctx: RequestContext | undefined): string {
  const message = err instanceof Error ? err.message : String(err);
  const tripped = ctx?.dbUnreachable;
  if (!(tripped instanceof DatabaseUnreachableError)) return message;

  const endpoint = endpointOf(err);
  return endpoint
    ? `connect deadline exceeded: ${tripped.detail} (${endpoint})`
    : `connect deadline exceeded: ${tripped.detail}`;
}

/**
 * Long enough that an ordinary cold Workers connect (tens to low hundreds of
 * milliseconds, through Hyperdrive or direct) is never cut short, short enough
 * that a refusing host spends a fraction of the 1000-subrequest budget instead
 * of all of it.
 */
export const DEFAULT_CONNECT_DEADLINE_MS = 1500;

/**
 * Resolve the deadline override, treating a **blank** value as absent.
 *
 * The blank check is not defensive tidying, it is the whole point: `Number('')`
 * is `0`, and `0` is a meaningful value here — it arms the deadline on the first
 * macrotask, which is how this module's own tests force an immediate trip. So a
 * blank override does not fall back, it selects the most aggressive setting
 * available, and every DB-touching request in the Worker answers `503 Database
 * unreachable: no connection could be established` against a database that is
 * perfectly healthy.
 *
 * Blank is the realistic shape of a misconfiguration at the edge rather than a
 * hypothetical one. A GitHub Actions expression for a secret that does not exist
 * expands to the empty string, and `wrangler secret put` then stores it and
 * prints `✨ Success!` — `set-worker-secrets.yml` documents exactly that
 * happening to `ANTHROPIC_API_KEY` on run 33972091515. There it disables a
 * feature; here it would counterfeit the WIC-2092 data-plane outage, character
 * for character, on a healthy deployment.
 *
 * `lib/pagination.ts` already carries this same trap and its remedy (WIC-1308):
 * *"`Number('')` is `0`, so a cursor decoding to nothing would silently mean
 * page one — the failure mode being fixed, just quieter."* Same coercion, same
 * quiet direction, and this resolver was the copy without the guard.
 *
 * An explicit `'0'` keeps meaning zero. Rejecting zero outright would also make
 * blank default, and it is the tempting one-character version of this fix, but
 * it would take the instant-trip escape hatch with it.
 */
export function resolveConnectDeadlineMs(raw: string | undefined): number {
  // `trim()` rather than `=== ''`: a value pushed through a shell or a YAML
  // block can arrive as a lone newline, and `Number('\n')` is `0` too.
  if (raw === undefined || raw.trim() === '') return DEFAULT_CONNECT_DEADLINE_MS;
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
