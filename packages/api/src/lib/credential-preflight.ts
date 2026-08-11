/**
 * Boot-time credential validation (ADR-0001, Pillar 1 — WIC-878).
 *
 * A small, reusable helper that runs a cheap *authenticated* ping per provider so
 * a bad credential fails loudly and greppably at boot — naming the exact env var
 * and provider — instead of failing deep in a run as an opaque 401/403.
 *
 * Design notes:
 *   - Dependency-injected (`env`, `fetch`, `exec`) so every path is unit-testable
 *     without touching the network or the real environment.
 *   - NEVER logs secret material. Result `detail` strings only ever contain the
 *     provider, the env-var *name*, and HTTP status codes — never the value.
 *   - Encodes the GitHub env-precedence trap (ADR-0001 Pillar 2): a present-but-
 *     invalid `GITHUB_TOKEN` shadows a valid stored `gh` credential, so it is a
 *     hard failure even when `gh auth status` would otherwise pass. Unset beats
 *     invalid.
 */

export type ProviderId = 'github' | 'anthropic' | 'gemini' | 'cloudflare' | 'supabase' | 'twilio';

export const ALL_PROVIDERS: ProviderId[] = [
  'github',
  'anthropic',
  'gemini',
  'cloudflare',
  'supabase',
  'twilio',
];

export type CheckOutcome = 'ok' | 'fail' | 'skipped';

export interface CheckResult {
  provider: ProviderId;
  outcome: CheckOutcome;
  /** The env var to fix. Omitted when not applicable (e.g. stored gh credential). */
  var?: string;
  /** Short, greppable slug, e.g. `unauthorized`, `missing-var`, `not-configured`. */
  reason: string;
  /** Human-readable. NEVER contains secret material — only var names + status codes. */
  detail: string;
}

export interface ExecResult {
  /** Process exit code. */
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command, resolving with its exit code. Rejects if the binary is missing. */
export type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

export interface PreflightDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  exec: ExecFn;
  /** Per-ping timeout in ms (default 5000). Keeps boot from hanging on a dead host. */
  timeoutMs?: number;
}

export interface PreflightOptions {
  /**
   * Providers that MUST be configured and valid. A provider not in this set that
   * has no credentials configured is `skipped` rather than failed. Defaults to
   * every provider passed to `runPreflight`.
   */
  required?: ProviderId[];
}

const DEFAULT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function ok(provider: ProviderId, varName: string | undefined, detail: string): CheckResult {
  return { provider, outcome: 'ok', var: varName, reason: 'ok', detail };
}

function fail(
  provider: ProviderId,
  varName: string | undefined,
  reason: string,
  detail: string
): CheckResult {
  return { provider, outcome: 'fail', var: varName, reason, detail };
}

function skip(provider: ProviderId, reason: string, detail: string): CheckResult {
  return { provider, outcome: 'skipped', reason, detail };
}

function notConfigured(provider: ProviderId, varName: string, required: boolean): CheckResult {
  if (required) {
    return fail(
      provider,
      varName,
      'missing-var',
      `${varName} is required for ${provider} but is not set.`
    );
  }
  return skip(provider, 'not-configured', `${varName} not set; ${provider} check skipped.`);
}

// ---------------------------------------------------------------------------
// HTTP ping helper
// ---------------------------------------------------------------------------

type PingResult = { status: number; ok: boolean } | { error: string };

async function ping(deps: PreflightDeps, url: string, init: RequestInit): Promise<PingResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { ...init, signal: controller.signal });
    // Drain the body so the socket can be reused; we never inspect or log it.
    await res.text().catch(() => '');
    return { status: res.status, ok: res.ok };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    return { error: name === 'AbortError' ? 'timeout' : name };
  } finally {
    clearTimeout(timer);
  }
}

type PingBodyResult = { status: number; ok: boolean; body: unknown } | { error: string };

/**
 * Like `ping`, but best-effort parses the JSON response body. Only used where the
 * status code alone is not enough — e.g. Cloudflare's token-verify endpoints return
 * HTTP 200 for a disabled/expired token and encode validity in `result.status`.
 * Never logs the body; callers only read specific non-secret fields.
 */
async function pingWithBody(
  deps: PreflightDeps,
  url: string,
  init: RequestInit
): Promise<PingBodyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => '');
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.status, ok: res.ok, body };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    return { error: name === 'AbortError' ? 'timeout' : name };
  } finally {
    clearTimeout(timer);
  }
}

/** 200 → ok; 401/403 → unauthorized; anything else → unexpected-status. */
function interpret(
  provider: ProviderId,
  varName: string,
  result: PingResult,
  host: string
): CheckResult {
  if ('error' in result) {
    return fail(
      provider,
      varName,
      'network-error',
      `Could not reach ${host} to validate ${varName} (${result.error}).`
    );
  }
  if (result.status === 200) {
    return ok(provider, varName, `${varName} authenticated against ${host} (HTTP 200).`);
  }
  if (result.status === 401 || result.status === 403) {
    return fail(
      provider,
      varName,
      'unauthorized',
      `${varName} was rejected by ${host} (HTTP ${result.status}).`
    );
  }
  return fail(
    provider,
    varName,
    'unexpected-status',
    `${host} returned HTTP ${result.status} while validating ${varName}.`
  );
}

// ---------------------------------------------------------------------------
// Per-provider checks
// ---------------------------------------------------------------------------

async function checkGithub(deps: PreflightDeps, required: boolean): Promise<CheckResult> {
  const token = deps.env.GITHUB_TOKEN?.trim();

  if (token) {
    // Precedence trap (ADR-0001 Pillar 2): env GITHUB_TOKEN wins over the stored gh
    // credential, so a stale/invalid value here silently shadows a good token and
    // 401s every run. Validate it directly and hard-fail if bad — unset beats invalid.
    const result = await ping(deps, 'https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'credential-preflight',
        Accept: 'application/vnd.github+json',
      },
    });
    if ('error' in result) {
      return fail(
        'github',
        'GITHUB_TOKEN',
        'network-error',
        `Could not reach api.github.com to validate GITHUB_TOKEN (${result.error}).`
      );
    }
    if (result.status === 200) {
      return ok(
        'github',
        'GITHUB_TOKEN',
        'GITHUB_TOKEN authenticated against api.github.com (HTTP 200).'
      );
    }
    return fail(
      'github',
      'GITHUB_TOKEN',
      'unauthorized',
      `GITHUB_TOKEN was rejected by api.github.com (HTTP ${result.status}). ` +
        `Env GITHUB_TOKEN takes precedence over the stored gh credential, so a stale value ` +
        `here shadows a valid token — unset GITHUB_TOKEN or replace it with a valid token.`
    );
  }

  // No GITHUB_TOKEN: fall back to the stored gh credential.
  let exec: ExecResult;
  try {
    exec = await deps.exec('gh', ['auth', 'status']);
  } catch {
    if (required) {
      return fail(
        'github',
        'GITHUB_TOKEN',
        'gh-not-available',
        'No GITHUB_TOKEN set and the gh CLI is not available to verify a stored credential.'
      );
    }
    return skip('github', 'not-configured', 'No GITHUB_TOKEN set and gh CLI unavailable; skipped.');
  }
  if (exec.code === 0) {
    return ok('github', undefined, 'Stored gh credential is valid (gh auth status exited 0).');
  }
  if (required) {
    return fail(
      'github',
      'GITHUB_TOKEN',
      'no-credential',
      'No GITHUB_TOKEN set and gh auth status reports no valid stored credential.'
    );
  }
  return skip('github', 'not-configured', 'No GitHub credential configured; skipped.');
}

async function checkAnthropic(deps: PreflightDeps, required: boolean): Promise<CheckResult> {
  const key = deps.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return notConfigured('anthropic', 'ANTHROPIC_API_KEY', required);
  const result = await ping(deps, 'https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  });
  return interpret('anthropic', 'ANTHROPIC_API_KEY', result, 'api.anthropic.com');
}

async function checkGemini(deps: PreflightDeps, required: boolean): Promise<CheckResult> {
  const key = deps.env.GEMINI_API_KEY?.trim() ?? deps.env.GOOGLE_API_KEY?.trim();
  if (!key) return notConfigured('gemini', 'GEMINI_API_KEY', required);
  const result = await ping(
    deps,
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`,
    { headers: { Accept: 'application/json' } }
  );
  // Google returns 400/403 for a bad key; normalise those to unauthorized.
  if ('error' in result) {
    return interpret('gemini', 'GEMINI_API_KEY', result, 'generativelanguage.googleapis.com');
  }
  if (result.status === 400) {
    return fail(
      'gemini',
      'GEMINI_API_KEY',
      'unauthorized',
      'GEMINI_API_KEY was rejected by generativelanguage.googleapis.com (HTTP 400).'
    );
  }
  return interpret('gemini', 'GEMINI_API_KEY', result, 'generativelanguage.googleapis.com');
}

/** Pulls `result.status` (active|disabled|expired) out of a CF token-verify body. */
function cfTokenStatus(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const result = (body as { result?: unknown }).result;
    if (result && typeof result === 'object') {
      const status = (result as { status?: unknown }).status;
      if (typeof status === 'string') return status;
    }
  }
  return undefined;
}

async function checkCloudflare(deps: PreflightDeps, required: boolean): Promise<CheckResult> {
  const token = deps.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) return notConfigured('cloudflare', 'CLOUDFLARE_API_TOKEN', required);
  const accountId = deps.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const host = 'api.cloudflare.com';

  // WIC-903: the user-scoped /user/tokens/verify endpoint returns 401 (code 1000,
  // "Invalid API Token") for an account-scoped, least-privilege Workers+R2 deploy
  // token — which is exactly the correct token to use in CI. So when an account id
  // is known, verify against the *account-scoped* endpoint, which is the right one
  // for such tokens and returns HTTP 200 with result.status = active|disabled|expired.
  if (accountId) {
    const res = await pingWithBody(
      deps,
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`,
      { headers: auth }
    );
    if ('error' in res) {
      return fail(
        'cloudflare',
        'CLOUDFLARE_API_TOKEN',
        'network-error',
        `Could not reach ${host} to validate CLOUDFLARE_API_TOKEN (${res.error}).`
      );
    }
    if (res.status === 200) {
      const status = cfTokenStatus(res.body);
      if (status && status !== 'active') {
        return fail(
          'cloudflare',
          'CLOUDFLARE_API_TOKEN',
          'token-inactive',
          `CLOUDFLARE_API_TOKEN is ${status} per the ${host} account token-verify endpoint.`
        );
      }
      return ok(
        'cloudflare',
        'CLOUDFLARE_API_TOKEN',
        `CLOUDFLARE_API_TOKEN verified against the ${host} account-scoped token-verify endpoint ` +
          `(HTTP 200${status ? `, status=${status}` : ''}).`
      );
    }
    if (res.status === 401 || res.status === 403) {
      return fail(
        'cloudflare',
        'CLOUDFLARE_API_TOKEN',
        'unauthorized',
        `CLOUDFLARE_API_TOKEN was rejected by the ${host} account-scoped token-verify endpoint ` +
          `(HTTP ${res.status}) — the token is revoked or not scoped to CLOUDFLARE_ACCOUNT_ID.`
      );
    }
    return fail(
      'cloudflare',
      'CLOUDFLARE_API_TOKEN',
      'unexpected-status',
      `${host} returned HTTP ${res.status} while validating CLOUDFLARE_API_TOKEN.`
    );
  }

  // No account id: fall back to the user-scoped verify. A least-privilege,
  // account-scoped token legitimately 401s here (WIC-903), so a 401/403 is
  // ADVISORY (skipped), never a hard fail — we must not punish a valid
  // least-privilege token. Set CLOUDFLARE_ACCOUNT_ID for a definitive check.
  const res = await ping(deps, 'https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: auth,
  });
  if ('error' in res) {
    return fail(
      'cloudflare',
      'CLOUDFLARE_API_TOKEN',
      'network-error',
      `Could not reach ${host} to validate CLOUDFLARE_API_TOKEN (${res.error}).`
    );
  }
  if (res.status === 200) {
    return ok(
      'cloudflare',
      'CLOUDFLARE_API_TOKEN',
      `CLOUDFLARE_API_TOKEN verified against the ${host} user token-verify endpoint (HTTP 200).`
    );
  }
  if (res.status === 401 || res.status === 403) {
    return skip(
      'cloudflare',
      'advisory-unverified',
      `CLOUDFLARE_API_TOKEN could not be verified via the user-scoped endpoint (HTTP ${res.status}); ` +
        `this is expected for an account-scoped least-privilege token. ` +
        `Set CLOUDFLARE_ACCOUNT_ID for a definitive account-scoped check.`
    );
  }
  return fail(
    'cloudflare',
    'CLOUDFLARE_API_TOKEN',
    'unexpected-status',
    `${host} returned HTTP ${res.status} while validating CLOUDFLARE_API_TOKEN.`
  );
}

async function checkSupabase(deps: PreflightDeps, required: boolean): Promise<CheckResult> {
  const url = deps.env.SUPABASE_URL?.trim();
  const anon = deps.env.SUPABASE_ANON_KEY?.trim();
  if (!url) return notConfigured('supabase', 'SUPABASE_URL', required);
  if (!anon) return notConfigured('supabase', 'SUPABASE_ANON_KEY', required);
  const base = url.replace(/\/+$/, '');
  // GoTrue /auth/v1/settings: 200 with a valid publishable/anon key, 401 with a bad
  // one or none. A deleted/renamed project (WIC-863/868 class) surfaces as a
  // DNS/network error rather than 401.
  //
  // WIC-903: the PostgREST root (`/rest/v1/`) is NOT a safe probe for the current
  // Supabase API-key format. New-style publishable keys (`sb_publishable_…`) are
  // rejected there with HTTP 401 "Secret API key required" — only secret keys may
  // hit the root introspection endpoint — so a *valid* publishable key false-fails
  // exactly like the least-privilege Cloudflare token did. `/auth/v1/settings`
  // validates the key without demanding secret-key privileges and returns a clean
  // 200/401 for both legacy anon JWTs and new publishable keys.
  const result = await ping(deps, `${base}/auth/v1/settings`, {
    headers: { apikey: anon, Accept: 'application/json' },
  });
  if ('error' in result) {
    return fail(
      'supabase',
      'SUPABASE_URL',
      'network-error',
      `Could not reach the Supabase project at SUPABASE_URL (${result.error}) — ` +
        `the project may be paused, renamed, or deleted.`
    );
  }
  return interpret('supabase', 'SUPABASE_ANON_KEY', result, 'the Supabase auth endpoint');
}

async function checkTwilio(deps: PreflightDeps, required: boolean): Promise<CheckResult> {
  const sid = deps.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = deps.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid) return notConfigured('twilio', 'TWILIO_ACCOUNT_SID', required);
  if (!authToken) return notConfigured('twilio', 'TWILIO_AUTH_TOKEN', required);
  const basic = Buffer.from(`${sid}:${authToken}`).toString('base64');
  const result = await ping(
    deps,
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
    { headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' } }
  );
  return interpret('twilio', 'TWILIO_AUTH_TOKEN', result, 'api.twilio.com');
}

const CHECKS: Record<ProviderId, (deps: PreflightDeps, required: boolean) => Promise<CheckResult>> =
  {
    github: checkGithub,
    anthropic: checkAnthropic,
    gemini: checkGemini,
    cloudflare: checkCloudflare,
    supabase: checkSupabase,
    twilio: checkTwilio,
  };

// ---------------------------------------------------------------------------
// Orchestration + formatting
// ---------------------------------------------------------------------------

export async function runPreflight(
  providers: ProviderId[],
  deps: PreflightDeps,
  options: PreflightOptions = {}
): Promise<{ ok: boolean; results: CheckResult[] }> {
  const requiredSet = new Set<ProviderId>(options.required ?? providers);
  const results = await Promise.all(
    providers.map((provider) => CHECKS[provider](deps, requiredSet.has(provider)))
  );
  const ok = results.every((r) => r.outcome !== 'fail');
  return { ok, results };
}

/** A single greppable line. Tags: CREDENTIAL_PRECHECK_{OK,SKIP,FAIL}. */
export function formatResultLine(result: CheckResult): string {
  const tag =
    result.outcome === 'ok'
      ? 'CREDENTIAL_PRECHECK_OK'
      : result.outcome === 'skipped'
        ? 'CREDENTIAL_PRECHECK_SKIP'
        : 'CREDENTIAL_PRECHECK_FAIL';
  const parts = [tag, `provider=${result.provider}`];
  if (result.var) parts.push(`var=${result.var}`);
  parts.push(`reason=${result.reason}`);
  parts.push(`detail=${JSON.stringify(result.detail)}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Default (Node) dependency wiring
// ---------------------------------------------------------------------------

/** Node exec via child_process. Rejects with a distinct error if the binary is missing. */
export function nodeExec(): ExecFn {
  return async (command, args) => {
    const { execFile } = await import('node:child_process');
    return new Promise<ExecResult>((resolve, reject) => {
      execFile(command, args, { timeout: 10_000 }, (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('command-not-found'));
          return;
        }
        const errCode = err ? (err as NodeJS.ErrnoException).code : undefined;
        const code = err ? (typeof errCode === 'number' ? errCode : 1) : 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      });
    });
  };
}

export function defaultDeps(env: Record<string, string | undefined> = process.env): PreflightDeps {
  return { env, fetch: globalThis.fetch, exec: nodeExec(), timeoutMs: DEFAULT_TIMEOUT_MS };
}
