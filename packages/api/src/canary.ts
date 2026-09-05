/// <reference types="@cloudflare/workers-types" />
//
// WIC-2127 — Durable prod-canary cadence via a Cloudflare Worker Cron Trigger.
//
// WHY THIS EXISTS
//   The production canary previously lived only in `.github/workflows/supabase-
//   keepalive.yml` on a `*/15` GitHub Actions `schedule`. GitHub delivers only
//   ~5% of high-frequency scheduled ticks (WIC-2125: 39 of ~778 over 194.5h,
//   median gap 191 min, one 67h blind window) — so the "every 15 minutes"
//   monitor actually ran every ~3.2h. Cloudflare Cron Triggers are NOT subject
//   to that throttling: they fire the `scheduled()` handler on a real cadence,
//   independent of the app's own DB health.
//
//   This module is that handler's payload. It runs the SAME two probes, with the
//   SAME PASS/FAIL assertions, as the Actions canary, and surfaces a failure to
//   a human through a configurable alert route (see CanaryAlertMode). The two
//   probes are deliberately byte-for-byte faithful to the workflow so the
//   cutover changes cadence ONLY, never what "healthy" means.
//
// SCOPE FENCE
//   Cadence + delivery only. The data-plane outage this canary WATCHES is
//   WIC-2092 (production Hyperdrive provisioning, human-gated) — this file must
//   never try to fix it, only observe it. A red data-plane verdict is EXPECTED
//   while that outage is live (WIC-2123); it is not a canary bug.
//
// THE ALERT CREDENTIAL IS HUMAN-GATED
//   A Worker cannot surface a failure where a human sees it without an OUTBOUND
//   credential that no agent can mint. `CANARY_GITHUB_TOKEN` (a fine-grained PAT)
//   must be provisioned by a human via `wrangler secret put` on the `production`
//   Worker. Until it is set, the handler still runs both probes and logs the
//   verdicts (visible in `wrangler tail` / the Workers dashboard) but cannot open
//   or comment on an incident issue — mode falls back to "none" with a warning.

/**
 * Where a failure is surfaced to a human.
 *   - "github_issue"     (Option A, recommended): the Worker calls the GitHub
 *                        REST API directly to open/dedup the same incident issue
 *                        the Actions canary files today. Self-contained; does not
 *                        depend on the Actions workflow surviving.
 *   - "workflow_dispatch" (Option B): the Worker triggers the existing
 *                        `supabase-keepalive.yml` via workflow_dispatch, reusing
 *                        that workflow's free GITHUB_TOKEN + issue-filing.
 *   - "none":            probes run and log, but nothing is filed. The safe
 *                        default when no token is configured.
 */
export type CanaryAlertMode = 'github_issue' | 'workflow_dispatch' | 'none';

export interface CanaryEnv {
  /** Prod base URL. Defaults to https://app.careerpin.app (the API Worker; the apex 405s). */
  CANARY_PROD_BASE_URL?: string;
  /** Alert route. Defaults to "github_issue" when a token is present, else "none". */
  CANARY_ALERT_MODE?: string;
  /** Fine-grained GitHub PAT — human-provisioned secret. issues:write (A) or actions:write (B). */
  CANARY_GITHUB_TOKEN?: string;
  /** "owner/repo" the incident issue lives in. Defaults to wickidcool/job-app-management. */
  CANARY_GITHUB_REPO?: string;
  /** Option B only: workflow file id to dispatch. Defaults to supabase-keepalive.yml. */
  CANARY_WORKFLOW_FILE?: string;
  /** Option B only: git ref to dispatch against. Defaults to main. */
  CANARY_WORKFLOW_REF?: string;
}

const DEFAULT_BASE_URL = 'https://app.careerpin.app';
const DEFAULT_REPO = 'wickidcool/job-app-management';
const DEFAULT_WORKFLOW_FILE = 'supabase-keepalive.yml';
const DEFAULT_WORKFLOW_REF = 'main';
const INCIDENT_TITLE = '🔴 Prod canary FAILED — production auth or data plane may be down';
// The dedup search the Actions canary uses; kept identical so both channels
// converge on ONE standing incident issue rather than two parallel threads.
const INCIDENT_SEARCH = 'in:title "Prod canary FAILED"';
// A non-existent canary account with a deliberately-wrong password. It can never
// authenticate and never mutates state (signInWithPassword only reads).
const CANARY_EMAIL = 'auth-canary-invalid@careerpin.app';
const CANARY_PASSWORD = 'wic1296-synthetic-canary-not-a-real-password'; // secret-scan:allow — deliberately-invalid synthetic canary credential (WIC-1296); it can never authenticate and is not a real secret
const PROBE_TIMEOUT_MS = 25_000;

export interface ProbeVerdict {
  ok: boolean;
  /** Human-readable line, mirroring the workflow's verdict prose. */
  message: string;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Auth plane. POST invalid canary credentials to /api/auth/login.
 * PASS iff the structured rejection `.error.message === "Invalid login credentials"`,
 * which only a live Supabase produces (WIC-1281/WIC-1296). FAIL on unreachable,
 * any 5xx, non-JSON, or any other message (the WIC-1281 empty-"{}"/AUTH_ERROR signature).
 */
export async function probeAuthPlane(baseUrl: string): Promise<ProbeVerdict> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CANARY_EMAIL, password: CANARY_PASSWORD }),
    });
  } catch (err) {
    return {
      ok: false,
      message: `🔴 AUTH PLANE: could NOT reach ${url} (${(err as Error).message}). Production auth may be unreachable. See WIC-1281/WIC-1296.`,
    };
  }

  if (res.status >= 500) {
    return {
      ok: false,
      message: `🔴 AUTH PLANE: HTTP ${res.status} from ${url} — a 5xx means the auth stack itself is failing server-side. See WIC-1281/WIC-1296.`,
    };
  }

  const bodyText = await res.text();
  let msg: string;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
    msg = parsed.error?.message ?? '';
  } catch {
    return {
      ok: false,
      message: `🔴 AUTH PLANE: NON-JSON / unparseable body from ${url} (http ${res.status}). Production auth is degraded — the WIC-1281 outage signature.`,
    };
  }

  if (msg === 'Invalid login credentials') {
    return {
      ok: true,
      message: `✅ AUTH PLANE: LIVE — structured rejection 'Invalid login credentials' at HTTP ${res.status}. The login path reached Supabase and it validated.`,
    };
  }

  return {
    ok: false,
    message: `🔴 AUTH PLANE FAILED: expected HTTP 401 with message 'Invalid login credentials' but got http=${res.status} message='${msg}'. An empty/'{}'/AUTH_ERROR-without-validation body is the exact WIC-1281 signature — production auth may be DOWN. See WIC-1296.`,
  };
}

/**
 * Data plane. GET /api/health.
 * PASS iff HTTP 200 AND `.status === "ok"`. FAIL on anything else — the live
 * outage signature is HTTP 503 with `{"status":"degraded","hyperdrive":false,
 * "db":"write CONNECTION_DESTROYED ..."}` (WIC-2092), which the auth probe is
 * structurally blind to (WIC-2123). Names hyperdrive/db verbatim so the incident
 * issue is self-diagnosing.
 */
export async function probeDataPlane(baseUrl: string): Promise<ProbeVerdict> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/health`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    return {
      ok: false,
      message: `🔴 DATA PLANE: could NOT reach ${url} (${(err as Error).message}). Production data plane is unreachable. See WIC-2123/WIC-2092.`,
    };
  }

  const bodyText = await res.text();
  let status: unknown;
  let hyperdrive: unknown;
  let db: unknown;
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    status = parsed.status;
    hyperdrive = 'hyperdrive' in parsed ? parsed.hyperdrive : '<absent>';
    db = 'db' in parsed ? parsed.db : '<absent>';
  } catch {
    return {
      ok: false,
      message: `🔴 DATA PLANE: /api/health returned http=${res.status} with a NON-JSON body: ${bodyText}. See WIC-2123/WIC-2092.`,
    };
  }

  const render = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

  if (res.status === 200 && status === 'ok') {
    return {
      ok: true,
      message: `✅ DATA PLANE: LIVE — /api/health http=200 status=ok (hyperdrive=${render(hyperdrive)}, db=${render(db)}).`,
    };
  }

  return {
    ok: false,
    message: `🔴 DATA PLANE DOWN: /api/health http=${res.status} status='${render(status)}' hyperdrive='${render(hyperdrive)}' db='${render(db)}'. Expected http=200 status=ok. This is the WIC-2092 Hyperdrive/pooler egress outage that the auth canary is structurally blind to. See WIC-2123/WIC-2092.`,
  };
}

function incidentBody(auth: ProbeVerdict, data: ProbeVerdict, source: string): string {
  return [
    'The scheduled production canary failed. It runs TWO independent probes and reports both verdicts below; a failure in either plane fails the run without masking the other.',
    '',
    `- ${auth.message}`,
    `- ${data.message}`,
    '',
    '**Auth plane** POSTs invalid canary credentials to `/api/auth/login` and expects the structured rejection `Invalid login credentials`, which only a live Supabase produces (WIC-1281/WIC-1296). It never dials Postgres.',
    '**Data plane** GETs `/api/health` and expects HTTP 200 with `status:ok`; HTTP 503 with `hyperdrive:false` / a destroyed `db` connection is the WIC-2092 Hyperdrive/pooler egress outage the auth probe is structurally blind to (WIC-2123).',
    '',
    `Fired by: ${source} (Cloudflare Worker Cron Trigger, WIC-2127 — immune to the GitHub Actions schedule throttling measured in WIC-2125).`,
    '',
    'Runbook: WIC-2092 (data plane — Hyperdrive provisioning is human-gated), WIC-1296 / WIC-1281 (auth plane). A paused Supabase project can only be restored by the account owner in the console.',
  ].join('\n');
}

/**
 * Option A — dedup + file the incident issue directly via the GitHub REST API.
 * Comments on the standing open issue if one exists, else opens a fresh one, so a
 * multi-day outage yields ONE issue with comments, not one per tick. Converges on
 * the same issue the Actions canary uses (identical title + dedup search).
 */
async function alertViaGithubIssue(
  env: CanaryEnv,
  auth: ProbeVerdict,
  data: ProbeVerdict
): Promise<void> {
  const token = env.CANARY_GITHUB_TOKEN!;
  const repo = env.CANARY_GITHUB_REPO || DEFAULT_REPO;
  const body = incidentBody(auth, data, 'Cloudflare cron');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'jobtrail-canary-cron',
    'Content-Type': 'application/json',
  };

  const searchUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(
    `repo:${repo} is:issue is:open ${INCIDENT_SEARCH}`
  )}`;
  const searchRes = await fetchWithTimeout(searchUrl, { headers });
  if (!searchRes.ok) {
    throw new Error(
      `GitHub issue search failed: HTTP ${searchRes.status} ${await searchRes.text()}`
    );
  }
  const search = (await searchRes.json()) as { items?: Array<{ number: number }> };
  const existing = search.items?.[0]?.number;

  if (existing) {
    const commentRes = await fetchWithTimeout(
      `https://api.github.com/repos/${repo}/issues/${existing}/comments`,
      { method: 'POST', headers, body: JSON.stringify({ body }) }
    );
    if (!commentRes.ok) {
      throw new Error(
        `GitHub issue comment failed: HTTP ${commentRes.status} ${await commentRes.text()}`
      );
    }
    console.log(`[canary] commented on open incident issue #${existing}`);
  } else {
    const createRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: INCIDENT_TITLE, body }),
    });
    if (!createRes.ok) {
      throw new Error(
        `GitHub issue create failed: HTTP ${createRes.status} ${await createRes.text()}`
      );
    }
    const created = (await createRes.json()) as { number?: number };
    console.log(`[canary] opened a new incident issue #${created.number}`);
  }
}

/**
 * Option B — trigger the existing supabase-keepalive.yml via workflow_dispatch.
 * The dispatched workflow re-runs the probes with its free GITHUB_TOKEN and does
 * the issue-filing itself; this Worker only pulls the trigger.
 */
async function alertViaWorkflowDispatch(env: CanaryEnv): Promise<void> {
  const token = env.CANARY_GITHUB_TOKEN!;
  const repo = env.CANARY_GITHUB_REPO || DEFAULT_REPO;
  const file = env.CANARY_WORKFLOW_FILE || DEFAULT_WORKFLOW_FILE;
  const ref = env.CANARY_WORKFLOW_REF || DEFAULT_WORKFLOW_REF;
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/actions/workflows/${file}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'jobtrail-canary-cron',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    }
  );
  if (!res.ok) {
    throw new Error(`workflow_dispatch failed: HTTP ${res.status} ${await res.text()}`);
  }
  console.log(`[canary] dispatched ${file} @ ${ref}`);
}

function resolveAlertMode(env: CanaryEnv): CanaryAlertMode {
  const raw = (env.CANARY_ALERT_MODE || '').trim();
  if (raw === 'github_issue' || raw === 'workflow_dispatch' || raw === 'none') return raw;
  // Default: file an issue directly when a token is present, otherwise stay silent.
  return env.CANARY_GITHUB_TOKEN ? 'github_issue' : 'none';
}

/**
 * The cron entry point. Runs both probes unconditionally (neither masks the
 * other), logs both verdicts, and alerts if EITHER failed. Never throws out to
 * the runtime for a probe failure — a red verdict is a normal, expected outcome
 * while WIC-2092 is live; only a genuinely broken alert channel is surfaced as
 * an error the Workers dashboard will show.
 */
export async function runCanary(
  env: CanaryEnv
): Promise<{ ok: boolean; auth: ProbeVerdict; data: ProbeVerdict }> {
  const baseUrl = env.CANARY_PROD_BASE_URL || DEFAULT_BASE_URL;
  const [auth, data] = await Promise.all([probeAuthPlane(baseUrl), probeDataPlane(baseUrl)]);
  console.log(`[canary] ${auth.message}`);
  console.log(`[canary] ${data.message}`);

  const ok = auth.ok && data.ok;
  if (ok) return { ok, auth, data };

  const mode = resolveAlertMode(env);
  if (mode === 'none') {
    console.warn(
      '[canary] a probe FAILED but no alert route is configured (CANARY_GITHUB_TOKEN unset). ' +
        'Verdicts are logged above only. Provision the token to surface failures to a human (WIC-2127).'
    );
    return { ok, auth, data };
  }

  try {
    if (mode === 'github_issue') {
      await alertViaGithubIssue(env, auth, data);
    } else {
      await alertViaWorkflowDispatch(env);
    }
  } catch (err) {
    // A broken alert channel is the one thing worth surfacing as an error.
    console.error(`[canary] alert via "${mode}" FAILED: ${(err as Error).message}`);
    throw err;
  }
  return { ok, auth, data };
}
