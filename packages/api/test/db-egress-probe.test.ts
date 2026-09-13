import { describe, expect, it, vi } from 'vitest';
import {
  CANDIDATE_PORTS,
  PROBE_DEADLINE_MS,
  classifyDialError,
  hostOf,
  probeDirectEgress,
  redact,
  withPort,
  type ProbeDeps,
  type ProbePool,
} from '../src/db/egress-probe.js';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/types/env.js';

const PW = 'p:a55/w0rd+9999';
const URL_ = `postgresql://postgres.fnmuvgnkxdeupprcyvdt:${encodeURIComponent(PW)}@aws-1-us-west-2.pooler.supabase.com:6543/postgres`;

/** A postgres-js `PostgresError`: built from a wire ErrorResponse, so it has `severity`. */
function serverError(code: string, message: string) {
  return Object.assign(new Error(message), { code, severity: 'FATAL' });
}

/** A postgres-js connection error: `code`, but never `severity`. */
function connectionError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function deps(
  outcomes: Array<{ resolve?: true; reject?: unknown; hang?: true }>,
  opts: { onEnd?: (port: number) => void } = {}
): { deps: ProbeDeps; dialled: string[]; timers: Array<() => void> } {
  const dialled: string[] = [];
  const timers: Array<() => void> = [];
  let call = 0;
  let clock = 0;
  return {
    dialled,
    timers,
    deps: {
      connect(connectionString: string) {
        dialled.push(connectionString);
        const outcome = outcomes[call++] ?? { hang: true };
        let port = NaN;
        try {
          port = Number(new URL(connectionString).port);
        } catch {
          /* the unparseable-URL case dials the string verbatim */
        }
        const pool: ProbePool = {
          end() {
            opts.onEnd?.(port);
            return Promise.resolve();
          },
        };
        if (outcome.resolve) return { pool, query: Promise.resolve([{ '?column?': 1 }]) };
        if (outcome.hang) return { pool, query: new Promise(() => {}) };
        return { pool, query: Promise.reject(outcome.reject) };
      },
      now: () => (clock += 17),
      setTimeout: (fn) => {
        timers.push(fn);
        return timers.length - 1;
      },
      clearTimeout: () => {},
    },
  };
}

describe('withPort', () => {
  it('swaps the port without touching a credential that contains digits and colons', () => {
    const swapped = withPort(URL_, 5432);
    expect(new URL(swapped).port).toBe('5432');
    expect(new URL(swapped).password).toBe(new URL(URL_).password);
    expect(new URL(swapped).hostname).toBe('aws-1-us-west-2.pooler.supabase.com');
  });

  it('does not corrupt a password whose encoded form looks like a port', () => {
    // The regex-shaped bug this guards: `:9999` also appears inside the secret.
    expect(withPort(URL_, 5432)).toContain(encodeURIComponent(PW));
  });
});

describe('hostOf', () => {
  it('reports the host and never the credential', () => {
    expect(hostOf(URL_)).toBe('aws-1-us-west-2.pooler.supabase.com');
    expect(hostOf(URL_)).not.toContain('9999');
  });

  it('degrades to a marker rather than echoing an unparseable string', () => {
    expect(hostOf('not a url')).toBe('unparseable');
  });
});

describe('redact', () => {
  it('removes the raw and the percent-encoded form of a secret', () => {
    const msg = `failed for ${PW} via ${encodeURIComponent(PW)}`;
    const out = redact(msg, [encodeURIComponent(PW)]);
    expect(out).not.toContain(PW);
    expect(out).not.toContain(encodeURIComponent(PW));
    expect(out).toContain('***');
  });

  it('replaces the longest secret first so no fragment survives', () => {
    // 'abc' is a prefix of 'abcdef': shortest-first would leave 'def' behind.
    expect(redact('abcdef', ['abc', 'abcdef'])).toBe('***');
  });

  it('is a no-op on a message containing no secret', () => {
    expect(redact('connect deadline exceeded', [encodeURIComponent(PW)])).toBe(
      'connect deadline exceeded'
    );
  });

  it('ignores empty secrets rather than replacing every character', () => {
    expect(redact('hello', ['', 'nope'])).toBe('hello');
  });
});

describe('classifyDialError', () => {
  it('treats a PostgresError as proof the connect completed', () => {
    // The load-bearing case: the far end spoke Postgres, so egress works even
    // though the answer was a rejection.
    const r = classifyDialError(serverError('28P01', 'password authentication failed'));
    expect(r.outcome).toBe('server_response');
    expect(r.connectCompleted).toBe(true);
    expect(r.detail).toContain('28P01');
  });

  it('treats a Supabase tenant rejection as a server response', () => {
    expect(
      classifyDialError(serverError('XX000', 'Tenant or user not found')).connectCompleted
    ).toBe(true);
  });

  it.each(['CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'ECONNREFUSED'])(
    'treats postgres-js connection error %s as no server response',
    (code) => {
      const r = classifyDialError(connectionError(code, 'write CONNECTION_DESTROYED'));
      expect(r.outcome).toBe('no_server_response');
      expect(r.connectCompleted).toBe(false);
    }
  );

  it('does not classify on message text', () => {
    // Every string in this outage has moved at least three times; a message
    // that merely mentions a password must not count as a server response.
    const r = classifyDialError(
      connectionError('CONNECT_TIMEOUT', 'password authentication failed')
    );
    expect(r.connectCompleted).toBe(false);
  });

  it('handles a non-Error throw', () => {
    expect(classifyDialError('boom').outcome).toBe('no_server_response');
    expect(classifyDialError(null).outcome).toBe('no_server_response');
  });
});

describe('probeDirectEgress', () => {
  it('probes both candidate ports in order', async () => {
    const d = deps([
      { reject: connectionError('CONNECT_TIMEOUT', 'nope') },
      { reject: connectionError('CONNECT_TIMEOUT', 'nope') },
    ]);
    const report = await probeDirectEgress(URL_, d.deps);
    expect(report.probes.map((p) => p.port)).toEqual([...CANDIDATE_PORTS]);
    expect(d.dialled.map((u) => new URL(u).port)).toEqual(['6543', '5432']);
    expect(report.anyConnectCompleted).toBe(false);
  });

  it('reports ok when the query succeeds', async () => {
    const d = deps([{ resolve: true }, { resolve: true }]);
    const report = await probeDirectEgress(URL_, d.deps);
    expect(report.probes[0].outcome).toBe('ok');
    expect(report.probes[0].connectCompleted).toBe(true);
    expect(report.anyConnectCompleted).toBe(true);
  });

  it('flags anyConnectCompleted when only the session pooler answers', async () => {
    // The finding that would restore prod without any Hyperdrive config.
    const d = deps([
      { reject: connectionError('CONNECTION_DESTROYED', 'write CONNECTION_DESTROYED') },
      { reject: serverError('28P01', 'password authentication failed') },
    ]);
    const report = await probeDirectEgress(URL_, d.deps);
    expect(report.probes[0].connectCompleted).toBe(false);
    expect(report.probes[1].connectCompleted).toBe(true);
    expect(report.anyConnectCompleted).toBe(true);
  });

  it('redacts the credential out of upstream error text', async () => {
    const d = deps([
      { reject: serverError('XX000', `connection to ${URL_} failed`) },
      { reject: connectionError('CONNECT_TIMEOUT', 'nope') },
    ]);
    const report = await probeDirectEgress(URL_, d.deps);
    const blob = JSON.stringify(report);
    expect(blob).not.toContain(PW);
    expect(blob).not.toContain(encodeURIComponent(PW));
    expect(report.probes[0].detail).toContain('***');
  });

  it('tears the pool down and reports a timeout when a dial hangs', async () => {
    const ended: number[] = [];
    const d = deps([{ hang: true }, { reject: connectionError('CONNECT_TIMEOUT', 'nope') }], {
      onEnd: (port) => ended.push(port),
    });
    const running = probeDirectEgress(URL_, d.deps);
    // Fire the deadline the probe armed for the hanging candidate.
    await vi.waitFor(() => expect(d.timers.length).toBe(1));
    d.timers[0]();
    const report = await running;
    expect(report.probes[0].outcome).toBe('no_server_response');
    expect(report.probes[0].detail).toContain(String(PROBE_DEADLINE_MS));
    // Dropping the pool is what stops postgres-js's re-arming dial loop.
    expect(ended).toContain(6543);
  });

  it('redacts an unparseable connection string wholesale', async () => {
    const d = deps([{ reject: serverError('XX000', 'secret-ish blob leaked') }]);
    const report = await probeDirectEgress('secret-ish blob', d.deps, [6543]);
    expect(report.host).toBe('unparseable');
    expect(report.probes[0].detail).not.toContain('secret-ish blob');
  });
});

describe('GET /health/egress', () => {
  const base: Env = { NODE_ENV: 'development', DATABASE_URL: URL_ };

  it('is not reachable in production', async () => {
    // The gate is the reason this handler may report upstream text at all.
    const res = await buildApp().request('/health/egress', {}, { ...base, NODE_ENV: 'production' });
    expect(res.status).toBe(404);
  });

  it('reports not_applicable when no DATABASE_URL binding exists', async () => {
    const res = await buildApp().request('/health/egress', {}, { NODE_ENV: 'development' } as Env);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'not_applicable' });
  });

  it('is served on the /api path too, ahead of the auth-guarded sub-app', async () => {
    // `/api/*` otherwise 401s before reaching a handler, which is the trap
    // `/api/health` already documents.
    const res = await buildApp().request('/api/health/egress', {}, {
      NODE_ENV: 'production',
    } as Env);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(401);
  });
});
