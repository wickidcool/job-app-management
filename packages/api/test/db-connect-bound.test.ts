import { EventEmitter } from 'node:events';
import net from 'node:net';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONNECT_DEADLINE_MS,
  createConnectBound,
  isDatabaseUnreachable,
  resolveConnectDeadlineMs,
} from '../src/db/connect-bound.js';
import { getDb } from '../src/db/client.js';
import { getRequestContext, runWithEnv } from '../src/db/context.js';
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
