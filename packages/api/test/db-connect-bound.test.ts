import { EventEmitter } from 'node:events';
import net from 'node:net';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONNECT_DEADLINE_MS,
  DatabaseUnreachableError,
  createConnectBound,
  describeDbFailure,
  isDatabaseUnreachable,
  resolveConnectDeadlineMs,
} from '../src/db/connect-bound.js';
import { getDb } from '../src/db/client.js';
import { getRequestContext, runWithEnv } from '../src/db/context.js';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/types/env.js';

/**
 * The socket the Cloudflare polyfill produces when a host accepts and closes,
 * which is the shape production hits: `close` with **no** `error` event.
 *
 * That distinction is the whole defect. An `error` reaches postgres-js's
 * `errored()`, which nulls the connection's `initial` query and stops the loop
 * after one dial — which is why a plain Node `ECONNREFUSED` is already bounded
 * and why this could never be reproduced against a local refusing port. Without
 * it, `closed()` takes `if (initial) return reconnect()` and re-dials forever.
 *
 * See `postgres/cf/polyfills.js`:
 *   tcp.raw.closed.then(() => close(), (e) => tcp.emit('error', e))
 * where `close()` emits `'close'` alone.
 */
let dials = 0;

class CleanClosingSocket extends EventEmitter {
  readyState = 'open';

  connect(): this {
    dials++;
    setImmediate(() => {
      this.readyState = 'closed';
      this.emit('close');
    });
    return this;
  }

  write(): boolean {
    return true;
  }
  end(): void {}
  destroy(): void {}
  setKeepAlive(): void {}
  setTimeout(): void {}
}

const realSocket = net.Socket;

/** Both Workers branches of getDb(), which run the same postgres-js dial loop. */
const WORKERS_BRANCHES: ReadonlyArray<{ name: string; env: Env }> = [
  {
    name: 'DATABASE_URL (production, direct Supabase)',
    env: { DATABASE_URL: 'postgres://u:p@db.example.invalid:5432/app' },
  },
  {
    name: 'HYPERDRIVE (preview)',
    env: { HYPERDRIVE: { connectionString: 'postgres://u:p@hd.example.invalid:5432/app' } },
  },
];

function withDeadline(env: Env, ms: string): Env {
  return { ...env, DB_CONNECT_DEADLINE_MS: ms };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 150));

describe('getDb() bounds the postgres-js initial connect loop', () => {
  beforeEach(() => {
    dials = 0;
    (net as { Socket: unknown }).Socket = CleanClosingSocket;
  });

  afterEach(() => {
    (net as { Socket: unknown }).Socket = realSocket;
  });

  describe.each(WORKERS_BRANCHES)('$name', ({ env }) => {
    it('spends a bounded number of dials and rejects the caller', async () => {
      await runWithEnv(withDeadline(env, '0'), async () => {
        const db = getDb();

        await expect(db.execute(sql`select 1`)).rejects.toSatisfy(isDatabaseUnreachable);

        // The deadline is the first macrotask after the pool is built, so the
        // dial loop gets exactly one iteration. Left unbounded this reaches the
        // Worker's 1000-subrequest budget instead.
        expect(dials).toBeLessThanOrEqual(2);
      });
    });

    it('stops dialling once the pool is torn down', async () => {
      await runWithEnv(withDeadline(env, '0'), async () => {
        const db = getDb();
        await db.execute(sql`select 1`).catch(() => {});

        const atRejection = dials;
        await settle();

        // The timing-independent invariant: the loop terminates. One dial may
        // already be in flight when the teardown lands; after that there are no
        // more, however long you wait. On an unbounded driver this keeps
        // climbing — measured at roughly 880 dials per second.
        expect(dials).toBeLessThanOrEqual(atRejection + 1);
      });
    });

    it('opens a circuit so nothing in the same request re-enters the loop', async () => {
      await runWithEnv(withDeadline(env, '0'), async () => {
        await getDb()
          .execute(sql`select 1`)
          .catch(() => {});
        const afterFirst = dials;

        // A second service call in the same invocation, exactly as a route with
        // more than one query would make.
        expect(() => getDb()).toThrow(/Database unreachable/);
        expect(dials).toBe(afterFirst);
        expect(getRequestContext()?.sql).toBeUndefined();
      });
    });

    // A blank override is what a *misconfiguration* looks like at the edge, not
    // what a typo looks like: `wrangler secret put` stores the empty string and
    // prints "✨ Success!" when its input expands to nothing, which is exactly
    // how `set-worker-secrets.yml` describes ANTHROPIC_API_KEY going empty on
    // run 33972091515. `Number('')` is `0`, so before this was guarded a blank
    // value armed a 0ms deadline and tripped the circuit on the first macrotask
    // — every DB-touching request answering 503 "Database unreachable: no
    // connection could be established" against a perfectly healthy database.
    // That is byte-identical to what the real WIC-2092 data-plane outage emits,
    // so the misconfiguration would be read as the outage.
    it('treats a blank override as unset rather than as a 0ms deadline', async () => {
      await runWithEnv(withDeadline(env, ''), async () => {
        const db = getDb();
        void db.execute(sql`select 1`).catch(() => {});
        // Captured before `settle()`: the trip happens on a later macrotask, so
        // the pool is still on the context here whether or not the bug is fixed
        // — which is what lets the teardown below run in either case.
        const pool = getRequestContext()?.sql as { end(o: { timeout: number }): Promise<unknown> };
        try {
          await settle();

          // The default deadline is 1500ms and `settle()` waits 150ms, so this
          // asserts the blank fell back to the default. With `Number('')`
          // flowing through it is 0ms and this is already tripped.
          expect(getRequestContext()?.dbUnreachable).toBeUndefined();
        } finally {
          await pool?.end({ timeout: 0 }).catch(() => {});
        }
      });
    });

    it('does not cut short a connect that is still making progress', async () => {
      await runWithEnv(withDeadline(env, '60000'), async () => {
        const db = getDb();
        void db.execute(sql`select 1`).catch(() => {});
        const pool = getRequestContext()?.sql as { end(o: { timeout: number }): Promise<unknown> };
        try {
          await settle();

          // Nothing has tripped: with a deadline it cannot reach, the request is
          // still waiting rather than being failed early.
          expect(getRequestContext()?.dbUnreachable).toBeUndefined();
          expect(dials).toBeGreaterThan(1);
        } finally {
          // This is the one case that leaves the loop running on purpose, so it
          // owns the teardown. Without it the loop outlives the test and the
          // dial counts of every later case are someone else's.
          await pool.end({ timeout: 0 }).catch(() => {});
        }
      });
    });
  });
});

describe('connect deadline configuration', () => {
  it('defaults when unset and when the override is not a usable number', () => {
    expect(resolveConnectDeadlineMs(undefined)).toBe(DEFAULT_CONNECT_DEADLINE_MS);
    expect(resolveConnectDeadlineMs('not-a-number')).toBe(DEFAULT_CONNECT_DEADLINE_MS);
    expect(resolveConnectDeadlineMs('-1')).toBe(DEFAULT_CONNECT_DEADLINE_MS);
    expect(resolveConnectDeadlineMs('250')).toBe(250);
    expect(resolveConnectDeadlineMs('0')).toBe(0);
  });

  // The `Number('')` trap `lib/pagination.ts` already documents and defends
  // against (WIC-1308: "a cursor decoding to nothing would silently mean page
  // one — the failure mode being fixed, just quieter"). Same coercion, same
  // quiet direction: blank is not a number, so it must reach the default and
  // not the instant-trip value that `'0'` deliberately still selects.
  it('treats a blank override as unset, not as zero', () => {
    expect(resolveConnectDeadlineMs('')).toBe(DEFAULT_CONNECT_DEADLINE_MS);
    expect(resolveConnectDeadlineMs(' ')).toBe(DEFAULT_CONNECT_DEADLINE_MS);
    expect(resolveConnectDeadlineMs('\n')).toBe(DEFAULT_CONNECT_DEADLINE_MS);
    expect(resolveConnectDeadlineMs('\t  ')).toBe(DEFAULT_CONNECT_DEADLINE_MS);

    // The escape hatch an explicit `'0'` provides is deliberate and stays —
    // three cases in this file arm an immediate trip with it. A fix that made
    // blank default by rejecting zero would break them, so pin it here too.
    expect(resolveConnectDeadlineMs('0')).toBe(0);
    expect(resolveConnectDeadlineMs(' 250 ')).toBe(250);
  });
});

describe('the deadline is disarmed by proof of a completed handshake', () => {
  const poolStub = () => {
    const ended: Array<{ timeout: number }> = [];
    return { ended, end: async (o: { timeout: number }) => void ended.push(o) };
  };

  it('does not tear down a pool whose startup handshake reported parameters', () => {
    vi.useFakeTimers();
    try {
      const ctx = { env: {} as Env };
      const pool = poolStub();
      const bound = createConnectBound(ctx, 1000);
      bound.arm(pool);

      // ParameterStatus can only arrive after a TCP connect and a completed
      // startup, so it is the earliest available proof the loop is over.
      bound.options.onparameter('server_version', '16.3');
      vi.advanceTimersByTime(5000);

      expect(ctx.dbUnreachable).toBeUndefined();
      expect(pool.ended).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tears the pool down with timeout 0 when no parameters ever arrive', () => {
    vi.useFakeTimers();
    try {
      const ctx = { env: {} as Env };
      const pool = poolStub();
      createConnectBound(ctx, 1000).arm(pool);

      vi.advanceTimersByTime(999);
      expect(pool.ended).toEqual([]);

      vi.advanceTimersByTime(1);
      // `timeout: 0` is what reaches postgres-js `terminate()`, which nulls the
      // connection's `initial` query. Anything larger waits for a graceful close
      // that a looping connection never performs.
      expect(pool.ended).toEqual([{ timeout: 0 }]);
      expect(isDatabaseUnreachable(ctx.dbUnreachable)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isDatabaseUnreachable', () => {
  it('covers the in-flight query that the teardown destroys', () => {
    const destroyed = Object.assign(new Error('write CONNECTION_DESTROYED'), {
      code: 'CONNECTION_DESTROYED',
    });
    expect(isDatabaseUnreachable(destroyed)).toBe(true);
  });

  it('leaves ordinary failures alone', () => {
    expect(isDatabaseUnreachable(new Error('relation "users" does not exist'))).toBe(false);
    expect(isDatabaseUnreachable(undefined)).toBe(false);
  });
});

/**
 * A socket that fails the way a *server-side* fault does: it emits `error`.
 *
 * That single difference is what separates the two branches under test. An
 * `error` reaches postgres-js's `errored()` (`connection.js:390-394`), which
 * nulls `initial` and rejects after one dial, so the connect deadline never
 * trips and no circuit opens. `CleanClosingSocket` above emits `close` alone,
 * which is the Cloudflare-polyfill shape that drives the dial loop into the
 * watchdog. Same endpoint, same driver, different cause — and the point of
 * WIC-2163 is that `/api/health` must not render them as the same string.
 */
class ErroringSocket extends EventEmitter {
  readyState = 'open';

  connect(): this {
    dials++;
    setImmediate(() => {
      this.readyState = 'closed';
      this.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    });
    return this;
  }

  write(): boolean {
    return true;
  }
  end(): void {}
  destroy(): void {}
  setKeepAlive(): void {}
  setTimeout(): void {}
}

interface HealthBody {
  status: string;
  hyperdrive: boolean;
  db: string;
}

/** Drive the real `/api/health` route through the real request context. */
async function getHealth(env: Env): Promise<{ httpStatus: number; body: HealthBody }> {
  const app = buildApp();
  return runWithEnv(env, async () => {
    const res = await app.fetch(
      new Request('https://health.example.invalid/api/health'),
      env as unknown as Record<string, unknown>
    );
    const body = (await res.json()) as HealthBody;
    // Whatever the outcome, this request's pool owns its own teardown so a
    // still-running dial loop cannot leak into a later case's dial count.
    const pool = getRequestContext()?.sql as
      | { end(o: { timeout: number }): Promise<unknown> }
      | undefined;
    await pool?.end({ timeout: 0 }).catch(() => {});
    return { httpStatus: res.status, body };
  });
}

const PROD_SHAPED_ENV: Env = {
  DATABASE_URL: 'postgres://u:p@aws-1-us-west-2.pooler.supabase.invalid:6543/app',
};

describe('/api/health names the cause, not postgres-js teardown collateral (WIC-2163)', () => {
  beforeEach(() => {
    dials = 0;
  });

  afterEach(() => {
    (net as { Socket: unknown }).Socket = realSocket;
  });

  it('reports our connect deadline, with the endpoint, when the watchdog trips', async () => {
    (net as { Socket: unknown }).Socket = CleanClosingSocket;

    const { httpStatus, body } = await getHealth({
      ...PROD_SHAPED_ENV,
      DB_CONNECT_DEADLINE_MS: '0',
    });

    // AC1 — the deadline is ours and the message says so.
    expect(body.db).toMatch(/^connect deadline exceeded: no connection within 0ms /);
    // The endpoint survives. It comes from postgres-js's ARRAY-valued `address`
    // and `port` fields, so a string-only guard drops it and this is the
    // assertion that catches that.
    expect(body.db).toContain('aws-1-us-west-2.pooler.supabase.invalid:6543');
    // The misleading string is gone — this is the whole point of the card.
    expect(body.db).not.toContain('CONNECTION_DESTROYED');

    // AC3 — the fields the WIC-2123 canary actually asserts on are untouched.
    // Its predicate is `http == 200 && status == "ok"`; `db` is display only.
    expect(httpStatus).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.hyperdrive).toBe(false);
  });

  it('leaves a genuine server-side disconnect reporting its own error', async () => {
    (net as { Socket: unknown }).Socket = ErroringSocket;

    // A long deadline the test cannot reach, so the watchdog is provably not
    // what ended this request — the server-side fault is.
    const { httpStatus, body } = await getHealth({
      ...PROD_SHAPED_ENV,
      DB_CONNECT_DEADLINE_MS: '60000',
    });

    // AC2 — the two causes must not collapse into one string.
    expect(body.db).toContain('ECONNRESET');
    expect(body.db).not.toContain('connect deadline exceeded');

    expect(httpStatus).toBe(503);
    expect(body.status).toBe('degraded');
  });

  it('still reports ok, http 200, when the probe succeeds', async () => {
    // No DB binding at all: the probe is skipped, which is the local/test path
    // and the only shape in this file that reaches the canary's PASS branch.
    const { httpStatus, body } = await getHealth({});

    expect(httpStatus).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('not_applicable');
  });
});

describe('describeDbFailure', () => {
  const tripped = (): { dbUnreachable: Error; env: Env } => ({
    env: {} as Env,
    dbUnreachable: new DatabaseUnreachableError('no connection within 1500ms'),
  });

  /** Exactly what postgres-js `terminate()` hands us: array-valued host/port. */
  const destroyed = (): Error =>
    Object.assign(
      new Error('write CONNECTION_DESTROYED aws-1-us-west-2.pooler.supabase.com:6543'),
      {
        code: 'CONNECTION_DESTROYED',
        errno: 'CONNECTION_DESTROYED',
        address: ['aws-1-us-west-2.pooler.supabase.com'],
        port: [6543],
      }
    );

  it('rewrites the teardown collateral when this request tripped the deadline', () => {
    expect(describeDbFailure(destroyed(), tripped())).toBe(
      'connect deadline exceeded: no connection within 1500ms (aws-1-us-west-2.pooler.supabase.com:6543)'
    );
  });

  it('passes a server-side failure through untouched when no circuit opened', () => {
    expect(describeDbFailure(destroyed(), { env: {} as Env })).toBe(
      'write CONNECTION_DESTROYED aws-1-us-west-2.pooler.supabase.com:6543'
    );
    expect(
      describeDbFailure(new Error('terminating connection due to administrator command'), {
        env: {} as Env,
      })
    ).toBe('terminating connection due to administrator command');
  });

  it('reads scalar and unix-socket endpoints as well as the array form', () => {
    const scalar = Object.assign(new Error('write CONNECTION_DESTROYED h:5432'), {
      address: 'h',
      port: 5432,
    });
    expect(describeDbFailure(scalar, tripped())).toContain('(h:5432)');

    // `options.path` sets `address` and leaves `port` undefined.
    const unix = Object.assign(new Error('write CONNECTION_DESTROYED /tmp/.s.PGSQL.5432'), {
      address: '/tmp/.s.PGSQL.5432',
    });
    expect(describeDbFailure(unix, tripped())).toBe(
      'connect deadline exceeded: no connection within 1500ms (/tmp/.s.PGSQL.5432)'
    );
  });

  it('still names the deadline when no endpoint can be recovered', () => {
    expect(describeDbFailure(new Error('write CONNECTION_DESTROYED'), tripped())).toBe(
      'connect deadline exceeded: no connection within 1500ms'
    );
    expect(describeDbFailure('not an error at all', { env: {} as Env })).toBe(
      'not an error at all'
    );
  });

  it('is a no-op without a request context', () => {
    expect(describeDbFailure(destroyed(), undefined)).toBe(
      'write CONNECTION_DESTROYED aws-1-us-west-2.pooler.supabase.com:6543'
    );
  });
});
