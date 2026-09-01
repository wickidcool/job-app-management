import net from 'node:net';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getDb } from '../src/db/client.js';
import { runWithEnv } from '../src/db/context.js';
import {
  CONNECT_BUDGET_TIMEOUT_MS,
  DbUnreachableError,
  isConnectBreakerOpen,
  resetConnectBreaker,
  tripConnectBreaker,
  withConnectBudget,
} from '../src/db/connect-budget.js';
import type { Env } from '../src/types/env.js';

/**
 * The budget defect, exercised against the connection layer PR #148's own test
 * stubs out. A refusing socket stands in for the prod database: it accepts a TCP
 * connection and immediately destroys it, so every dial is one countable
 * "subrequest" and postgres-js's initial-connect loop never gets a live session.
 *
 * This is the test WIC-1916 asks for: it drives `getDb()`'s Workers
 * direct-`DATABASE_URL` branch and counts dials, rather than injecting a
 * pre-formed `Error('Too many subrequests')` (which only re-tests the classifier).
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let server: net.Server;
let dials = 0;
let url = '';

beforeEach(async () => {
  dials = 0;
  resetConnectBreaker();
  server = net.createServer((socket) => {
    dials++;
    socket.destroy(); // refuse fast — the prod signature: fails before any SQL runs
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as net.AddressInfo;
  url = `postgresql://postgres:postgres@127.0.0.1:${addr.port}/postgres`;
});

afterEach(async () => {
  resetConnectBreaker();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(() => {
  // Nothing global to tear down; kept for symmetry with pool-heavy suites.
});

describe('postgres-js initial-connect loop is ceiling-less (the defect)', () => {
  it('re-dials an unreachable host without bound and never settles the query on its own', async () => {
    const pool = postgres(url, { prepare: false, max: 1, connect_timeout: 5 });
    // Attach a catch so the eventual rejection (once we end the pool) is handled.
    const query = pool`SELECT 1`.then(
      () => 'resolved',
      () => 'rejected'
    );

    await sleep(250);

    // A single logical op has issued many TCP connects — this is the budget drain.
    expect(dials).toBeGreaterThan(5);

    // ...and the promise is still pending: nothing inside postgres-js stops it.
    const settled = await Promise.race([query, sleep(20).then(() => 'pending')]);
    expect(settled).toBe('pending');

    // Ending the pool is the only thing that halts the loop and rejects the query.
    const dialsBeforeEnd = dials;
    await pool.end({ timeout: 0 });
    expect(await query).toBe('rejected');
    await sleep(200);
    // At most a already-scheduled residual dial lands after end(); then it stops.
    expect(dials - dialsBeforeEnd).toBeLessThanOrEqual(2);
  });
});

describe('withConnectBudget bounds the direct-DATABASE_URL branch', () => {
  it('rejects promptly, halts the dial loop, and trips the isolate breaker', async () => {
    await runWithEnv({ DATABASE_URL: url } as Env, async () => {
      const started = Date.now();
      await expect(
        withConnectBudget(() => getDb().execute(sql`SELECT 1`), 150)
      ).rejects.toBeInstanceOf(DbUnreachableError);
      const elapsed = Date.now() - started;

      // Bounded by the wall clock we passed, not the 8–14s full-budget drain.
      expect(elapsed).toBeLessThan(1000);

      // The loop stops after teardown instead of running to budget exhaustion.
      const dialsAtSettle = dials;
      await sleep(300);
      expect(dials - dialsAtSettle).toBeLessThanOrEqual(3);
    });

    // A failure leaves the isolate breaker open for the next request.
    expect(isConnectBreakerOpen()).toBe(true);
  });

  it('uses a conservative default ceiling', () => {
    expect(CONNECT_BUDGET_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CONNECT_BUDGET_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

describe('open breaker short-circuits the direct branch before dialing', () => {
  it('throws DbUnreachableError from getDb() with zero new dials', async () => {
    tripConnectBreaker('prior request proved the DB unreachable');

    await runWithEnv({ DATABASE_URL: url } as Env, async () => {
      const before = dials;
      expect(() => getDb()).toThrow(DbUnreachableError);
      await sleep(100);
      expect(dials).toBe(before); // never opened a socket
    });
  });

  it('does not gate the Hyperdrive path — only the direct-dial branch', async () => {
    // Hyperdrive proxies the connect, so it has no ceiling-less-retry hazard and
    // must stay reachable even while the direct-path breaker is open.
    tripConnectBreaker('direct path is down');
    await runWithEnv({ HYPERDRIVE: { connectionString: url } } as Env, async () => {
      expect(() => getDb()).not.toThrow();
    });
  });
});

describe('a success resets the breaker', () => {
  it('closes the breaker after a healthy op', async () => {
    tripConnectBreaker('was down');
    expect(isConnectBreakerOpen()).toBe(true);

    await withConnectBudget(async () => 'ok', 1000);

    expect(isConnectBreakerOpen()).toBe(false);
  });
});
