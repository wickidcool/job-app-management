// WIC-2127 — the Cloudflare Cron canary must apply the EXACT same PASS/FAIL
// assertions as the GitHub Actions canary in supabase-keepalive.yml. These tests
// pin those assertions so the cadence cutover can never silently change what
// "healthy" means. Each row mirrors a branch of the workflow's verdict logic.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeAuthPlane, probeDataPlane, runCanary } from '../src/canary.js';

const BASE = 'https://app.careerpin.app';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeAuthPlane (WIC-1281/WIC-1296 assertions)', () => {
  it('PASSES only on the exact structured rejection message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(401, { error: { message: 'Invalid login credentials' } }))
    );
    const v = await probeAuthPlane(BASE);
    expect(v.ok).toBe(true);
    expect(v.message).toContain('AUTH PLANE: LIVE');
  });

  it('FAILS on the WIC-1281 empty-message signature even at HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));
    const v = await probeAuthPlane(BASE);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('AUTH PLANE FAILED');
  });

  it('FAILS on any 5xx (auth stack failing server-side)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(503, { error: { message: 'x' } }))
    );
    const v = await probeAuthPlane(BASE);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('HTTP 503');
  });

  it('FAILS on a non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 502 }))
    );
    const v = await probeAuthPlane(BASE);
    expect(v.ok).toBe(false);
    // 502 is >=500 so it trips the 5xx branch first — still a FAIL, which is the point.
    expect(v.message).toMatch(/HTTP 502|NON-JSON/);
  });

  it('FAILS when the host is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const v = await probeAuthPlane(BASE);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('could NOT reach');
  });
});

describe('probeDataPlane (WIC-2123/WIC-2092 assertions)', () => {
  it('PASSES only on HTTP 200 AND status:ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { status: 'ok', hyperdrive: true, db: 'read ok' }))
    );
    const v = await probeDataPlane(BASE);
    expect(v.ok).toBe(true);
    expect(v.message).toContain('DATA PLANE: LIVE');
  });

  it('FAILS on the live WIC-2092 503 degraded signature and names hyperdrive/db', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          status: 'degraded',
          hyperdrive: false,
          db: 'write CONNECTION_DESTROYED',
        })
      )
    );
    const v = await probeDataPlane(BASE);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('DATA PLANE DOWN');
    expect(v.message).toContain('hyperdrive=');
    // regression guard: false must render verbatim, not as an empty string
    expect(v.message).toContain("hyperdrive='false'");
    expect(v.message).toContain('CONNECTION_DESTROYED');
  });

  it('FAILS on HTTP 200 but status not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'degraded' })));
    const v = await probeDataPlane(BASE);
    expect(v.ok).toBe(false);
  });

  it('FAILS on a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 200 })));
    const v = await probeDataPlane(BASE);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('NON-JSON');
  });
});

describe('runCanary alert routing', () => {
  it('does not alert when both probes pass', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/api/auth/login')) {
        return jsonResponse(401, { error: { message: 'Invalid login credentials' } });
      }
      return jsonResponse(200, { status: 'ok' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await runCanary({});
    expect(res.ok).toBe(true);
    // only the two probe calls, no api.github.com traffic
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('api.github.com'))).toBe(true);
  });

  it('stays silent (mode none) on failure when no token is configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503, { status: 'degraded' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await runCanary({});
    expect(res.ok).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('api.github.com'))).toBe(false);
  });

  it('files a NEW incident issue on failure when a token is present and none is open', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.endsWith('/api/auth/login')) return jsonResponse(401, { error: { message: 'nope' } });
      if (u.endsWith('/api/health')) return jsonResponse(503, { status: 'degraded' });
      if (u.includes('/search/issues')) return jsonResponse(200, { items: [] });
      if (u.match(/\/repos\/.+\/issues$/)) return jsonResponse(201, { number: 999 });
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await runCanary({ CANARY_GITHUB_TOKEN: 'x', CANARY_GITHUB_REPO: 'o/r' });
    expect(res.ok).toBe(false);
    expect(calls.some((c) => c.startsWith('POST') && /\/repos\/o\/r\/issues$/.test(c))).toBe(true);
  });

  it('COMMENTS on the standing issue instead of opening a duplicate', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.endsWith('/api/auth/login')) return jsonResponse(401, { error: { message: 'nope' } });
      if (u.endsWith('/api/health')) return jsonResponse(503, { status: 'degraded' });
      if (u.includes('/search/issues')) return jsonResponse(200, { items: [{ number: 414 }] });
      if (u.includes('/issues/414/comments')) return jsonResponse(201, { id: 1 });
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await runCanary({ CANARY_GITHUB_TOKEN: 'x', CANARY_GITHUB_REPO: 'o/r' });
    expect(calls.some((c) => c.includes('/issues/414/comments'))).toBe(true);
    expect(calls.some((c) => /\/repos\/o\/r\/issues$/.test(c))).toBe(false);
  });

  it('dispatches the workflow in workflow_dispatch mode', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.endsWith('/api/auth/login')) return jsonResponse(401, { error: { message: 'nope' } });
      if (u.endsWith('/api/health')) return jsonResponse(503, { status: 'degraded' });
      if (u.includes('/dispatches')) return new Response(null, { status: 204 });
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await runCanary({
      CANARY_GITHUB_TOKEN: 'x',
      CANARY_GITHUB_REPO: 'o/r',
      CANARY_ALERT_MODE: 'workflow_dispatch',
    });
    expect(
      calls.some((c) => c.includes('/actions/workflows/supabase-keepalive.yml/dispatches'))
    ).toBe(true);
  });
});
