import postgres from 'postgres';

/**
 * WIC-1386 — measure the one cell of the Hyperdrive A/B nobody has filled in.
 *
 * The standing diagnosis is that production is 503 because root `wrangler.jsonc`
 * declares `hyperdrive` under `env.preview` only, so the production Worker falls
 * through `client.ts`'s `ctx.env.HYPERDRIVE` branch to a **direct** dial of
 * `DATABASE_URL` — the leg that answers `connect deadline exceeded`.
 *
 * The evidence for that is a two-cell comparison, and it varies two things at
 * once:
 *
 * | Worker  | Hyperdrive | target DB | result                            |
 * |---------|------------|-----------|-----------------------------------|
 * | preview | yes        | dev       | `password authentication failed`  |
 * | prod    | no         | prod      | `connect deadline exceeded`       |
 *
 * A server-side error proves the connect *completed*; a deadline trip proves
 * only that we gave up. But "Hyperdrive present" and "which database" move
 * together across those two rows, so the comparison cannot tell
 * "a Worker cannot direct-dial a Supabase pooler at all" apart from
 * "this particular prod dial fails". The missing cell is a **preview** Worker
 * dialling **directly**, and preview already receives a `DATABASE_URL` secret
 * it never uses (`deploy.yml` pushes the same key set to both environments),
 * so that cell is measurable with no Cloudflare scope and no production deploy.
 *
 * `deploy.yml:641` additionally rewrites `:5432` to `:6543` on every path, so
 * the direct dial has only ever been attempted against the **transaction**
 * pooler. The session pooler on 5432 is a distinct listener and is probed here
 * as a second candidate: if it answers where 6543 does not, prod is restorable
 * by a port change and needs no Hyperdrive config at all.
 *
 * This module is diagnostic scaffolding. Delete it once WIC-1386 closes.
 */

/** Ports probed, in order. 6543 = transaction pooler (what prod dials), 5432 = session pooler. */
export const CANDIDATE_PORTS = [6543, 5432] as const;

/**
 * How long a single candidate may spend dialling before we tear its pool down.
 *
 * This is not belt-and-braces. postgres-js re-arms its connect timer on every
 * iteration of the initial-dial loop, so `connect_timeout` can never fire while
 * dials keep failing fast — the exact mechanism `connect-bound.ts` exists to
 * bound in the request path. An unbounded probe would spend the invocation's
 * 1000-subrequest budget instead of reporting a result.
 */
export const PROBE_DEADLINE_MS = 4000;

/**
 * ⚠️ Measured 2026-09-13 on preview `fa43e15d`: the 4s deadline above **does
 * not bind first**. The direct dial exhausts the invocation's entire
 * 1000-subrequest budget in ~3.5s and fails with *"Too many subrequests by
 * single Worker invocation"* — the same string production carried before #364
 * renamed it.
 *
 * The consequence is a reporting trap, and it caught this module's own first
 * run. The budget is **per invocation**, not per dial, so once the first
 * candidate has spent it every later candidate in the same request fails
 * instantly on a budget error it inherited rather than earned: the second probe
 * returned `elapsedMs: 0` with a verdict that measured nothing. A multi-port
 * response is therefore **one measurement and N-1 artifacts**.
 *
 * `?port=` exists so each candidate gets a fresh invocation. Prefer it, and
 * distrust any `no_server_response` whose `elapsedMs` is ~0 — that is the
 * signature of an inherited budget error, not of a refusing host.
 */
export const BUDGET_NOTE =
  'the subrequest budget is per invocation: in a multi-port response only the first probe is a measurement. Use ?port= for the rest.';

export type EgressOutcome = 'ok' | 'server_response' | 'no_server_response';

export interface EgressProbeResult {
  port: number;
  /** Outcome class. `server_response` is the load-bearing one — see `classifyDialError`. */
  outcome: EgressOutcome;
  /**
   * True when the far end spoke Postgres to us. That can only happen after the
   * TCP connect completed *and* the startup handshake got far enough to be
   * answered, so it is positive proof of egress regardless of whether the
   * answer was an error.
   */
  connectCompleted: boolean;
  elapsedMs: number;
  detail: string;
}

/** Minimal shape of the pool this module drives, so tests need no real socket. */
export interface ProbePool {
  end(options?: { timeout?: number }): Promise<unknown> | unknown;
}

export interface ProbeDeps {
  /** Injected so tests can drive outcomes without a network. */
  connect(connectionString: string): { pool: ProbePool; query: Promise<unknown> };
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Swap the port on a Postgres connection string, preserving everything else.
 *
 * Uses `URL` rather than a regex because the password is percent-encoded and
 * may itself contain digits and colons; a naive `:\d+` replacement can land
 * inside the credential.
 *
 * An unparseable string is returned unchanged rather than thrown on. A blank or
 * malformed secret is the realistic misconfiguration at this edge — the same
 * shape `resolveConnectDeadlineMs` guards against — and a diagnostic endpoint
 * that 500s on it reports strictly less than one that dials it and classifies
 * the failure.
 */
export function withPort(connectionString: string, port: number): string {
  try {
    const url = new URL(connectionString);
    url.port = String(port);
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Host of a connection string, for reporting. Never includes credentials. */
export function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return 'unparseable';
  }
}

/**
 * Strip anything credential-shaped out of a message before it leaves the Worker.
 *
 * The probe reports upstream error text verbatim, and postgres-js errors have
 * historically carried the connection string. This endpoint is unauthenticated,
 * so redaction is a correctness requirement, not hygiene: both the raw and the
 * percent-encoded forms of the password are replaced, longest first so a
 * password that is a prefix of another secret cannot survive as a fragment.
 */
export function redact(message: string, secrets: readonly string[]): string {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    forms.add(secret);
    try {
      forms.add(decodeURIComponent(secret));
    } catch {
      /* a malformed escape is not a second form */
    }
    forms.add(encodeURIComponent(secret));
  }
  let out = message;
  for (const form of [...forms].sort((a, b) => b.length - a.length)) {
    if (!form) continue;
    out = out.split(form).join('***');
  }
  return out;
}

/**
 * Decide whether an error came from the database or from our own giving up.
 *
 * postgres-js distinguishes these structurally: a `PostgresError` is built from
 * a wire-protocol ErrorResponse and therefore carries `severity` alongside a
 * SQLSTATE `code`, while its connection errors (`CONNECT_TIMEOUT`,
 * `CONNECTION_CLOSED`, `CONNECTION_DESTROYED`, `ECONNREFUSED`) carry a `code`
 * and **no** `severity`. Presence of `severity` is the discriminator; matching
 * on message text is not, because those strings have moved three times during
 * this outage alone.
 */
export function classifyDialError(err: unknown): {
  outcome: Exclude<EgressOutcome, 'ok'>;
  connectCompleted: boolean;
  detail: string;
} {
  const e = err as { code?: unknown; severity?: unknown; message?: unknown } | null;
  const message = e?.message === undefined ? String(err) : String(e.message);
  const code = typeof e?.code === 'string' ? e.code : '';
  const fromServer = typeof e?.severity === 'string' && code !== '';
  return {
    outcome: fromServer ? 'server_response' : 'no_server_response',
    connectCompleted: fromServer,
    detail: code ? `${code}: ${message}` : message,
  };
}

/**
 * Dial one candidate and classify the result, tearing the pool down on timeout.
 *
 * Resolves rather than rejects: a probe that throws tells the caller less than
 * one that reports which of the three outcomes it reached.
 */
export async function probeOne(
  connectionString: string,
  port: number,
  secrets: readonly string[],
  deps: ProbeDeps
): Promise<EgressProbeResult> {
  const started = deps.now();
  const target = withPort(connectionString, port);
  const { pool, query } = deps.connect(target);

  let timedOut = false;
  let handle: unknown;
  const deadline = new Promise<'timeout'>((resolve) => {
    handle = deps.setTimeout(() => {
      timedOut = true;
      // Dropping the pool is what stops the dial loop; rejecting alone would
      // leave it re-dialling for the rest of the invocation.
      void Promise.resolve(pool.end({ timeout: 0 })).catch(() => {
        /* teardown is best-effort */
      });
      resolve('timeout');
    }, PROBE_DEADLINE_MS);
  });

  const finish = (partial: Omit<EgressProbeResult, 'port' | 'elapsedMs'>): EgressProbeResult => ({
    port,
    elapsedMs: deps.now() - started,
    ...partial,
    detail: redact(partial.detail, secrets),
  });

  try {
    const outcome = await Promise.race([
      query.then(() => 'ok' as const).catch((err: unknown) => ({ err })),
      deadline,
    ]);

    if (outcome === 'ok') {
      return finish({ outcome: 'ok', connectCompleted: true, detail: 'SELECT 1 succeeded' });
    }
    if (outcome === 'timeout') {
      return finish({
        outcome: 'no_server_response',
        connectCompleted: false,
        detail: `no response within ${PROBE_DEADLINE_MS}ms`,
      });
    }
    // A rejection that lands after the deadline already fired describes the
    // teardown, not the far end, so the timeout verdict stands.
    if (timedOut) {
      return finish({
        outcome: 'no_server_response',
        connectCompleted: false,
        detail: `no response within ${PROBE_DEADLINE_MS}ms`,
      });
    }
    return finish(classifyDialError(outcome.err));
  } finally {
    deps.clearTimeout(handle);
    if (!timedOut) {
      void Promise.resolve(pool.end({ timeout: 0 })).catch(() => {
        /* teardown is best-effort */
      });
    }
  }
}

/** Real-socket dependencies. Mirrors the direct branch of `client.ts` exactly. */
export function realDeps(): ProbeDeps {
  return {
    connect(connectionString: string) {
      const sql = postgres(connectionString, {
        prepare: false,
        max: 1,
        connect_timeout: 5,
        ssl: 'require',
      });
      return { pool: sql as unknown as ProbePool, query: sql`SELECT 1` };
    },
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as never),
  };
}

export interface EgressReport {
  host: string;
  probes: EgressProbeResult[];
  /** True if any candidate got the far end to speak Postgres. */
  anyConnectCompleted: boolean;
}

/**
 * Probe every candidate port sequentially.
 *
 * Sequential, not parallel: concurrent dials share the invocation's subrequest
 * budget, and a first candidate that fails fast in a loop would starve the
 * second before it reported.
 */
export async function probeDirectEgress(
  databaseUrl: string,
  deps: ProbeDeps = realDeps(),
  ports: readonly number[] = CANDIDATE_PORTS
): Promise<EgressReport> {
  let secrets: readonly string[] = [];
  try {
    const url = new URL(databaseUrl);
    secrets = [url.password, url.username].filter(Boolean);
  } catch {
    // An unparseable URL has no extractable credential, but it may still *be*
    // one, so redact the whole string rather than reporting it.
    secrets = [databaseUrl];
  }

  const probes: EgressProbeResult[] = [];
  for (const port of ports) {
    probes.push(await probeOne(databaseUrl, port, secrets, deps));
  }
  return {
    host: hostOf(databaseUrl),
    probes,
    anyConnectCompleted: probes.some((p) => p.connectCompleted),
  };
}
