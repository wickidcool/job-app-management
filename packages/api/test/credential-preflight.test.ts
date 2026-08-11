import { describe, it, expect, vi } from 'vitest';
import {
  runPreflight,
  formatResultLine,
  type ExecFn,
  type ExecResult,
  type PreflightDeps,
  type ProviderId,
} from '../src/lib/credential-preflight.js';

/** Build a fake fetch that maps a URL substring → HTTP status (or throws for network errors). */
function fakeFetch(
  routes: Array<{ match: string; status?: number; throws?: string; body?: unknown }>
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`no fake route for ${url}`);
    if (route.throws) {
      const err = new Error(route.throws);
      err.name = route.throws;
      throw err;
    }
    const status = route.status ?? 200;
    const bodyText =
      route.body === undefined
        ? ''
        : typeof route.body === 'string'
          ? route.body
          : JSON.stringify(route.body);
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => bodyText,
    } as Response;
  }) as unknown as typeof fetch;
}

function fakeExec(result: ExecResult | { throws: string }): ExecFn {
  return vi.fn(async () => {
    if ('throws' in result) throw new Error(result.throws);
    return result;
  });
}

function deps(overrides: Partial<PreflightDeps>): PreflightDeps {
  return {
    env: {},
    fetch: fakeFetch([]),
    exec: fakeExec({ code: 0, stdout: '', stderr: '' }),
    timeoutMs: 100,
    ...overrides,
  };
}

async function checkOne(provider: ProviderId, d: PreflightDeps) {
  const { results } = await runPreflight([provider], d);
  return results[0];
}

describe('credential-preflight', () => {
  describe('GitHub env-precedence trap (ADR-0001 Pillar 2)', () => {
    it('FAILS loudly when GITHUB_TOKEN is present but invalid, even if a stored gh token is valid', async () => {
      const d = deps({
        env: { GITHUB_TOKEN: 'ghp_stale_placeholder' },
        fetch: fakeFetch([{ match: 'api.github.com', status: 401 }]),
        // stored gh credential is fine — but env token shadows it, so this must still fail
        exec: fakeExec({ code: 0, stdout: 'Logged in', stderr: '' }),
      });
      const res = await checkOne('github', d);
      expect(res.outcome).toBe('fail');
      expect(res.var).toBe('GITHUB_TOKEN');
      expect(res.reason).toBe('unauthorized');
      // The stored gh credential must NOT be consulted when GITHUB_TOKEN is present.
      expect(d.exec).not.toHaveBeenCalled();
    });

    it('passes when GITHUB_TOKEN is present and valid', async () => {
      const d = deps({
        env: { GITHUB_TOKEN: 'ghp_good' },
        fetch: fakeFetch([{ match: 'api.github.com', status: 200 }]),
      });
      const res = await checkOne('github', d);
      expect(res.outcome).toBe('ok');
      expect(res.var).toBe('GITHUB_TOKEN');
    });

    it('falls back to the stored gh credential when GITHUB_TOKEN is unset', async () => {
      const d = deps({ env: {}, exec: fakeExec({ code: 0, stdout: '', stderr: '' }) });
      const res = await checkOne('github', d);
      expect(res.outcome).toBe('ok');
      expect(d.exec).toHaveBeenCalledWith('gh', ['auth', 'status']);
    });

    it('fails when required, GITHUB_TOKEN unset, and gh reports no credential', async () => {
      const d = deps({ env: {}, exec: fakeExec({ code: 1, stdout: '', stderr: 'not logged in' }) });
      const { results } = await runPreflight(['github'], d, { required: ['github'] });
      expect(results[0].outcome).toBe('fail');
      expect(results[0].reason).toBe('no-credential');
    });

    it('skips (not fail) when github is optional, GITHUB_TOKEN unset, and gh CLI is missing', async () => {
      const d = deps({ env: {}, exec: fakeExec({ throws: 'command-not-found' }) });
      const { results } = await runPreflight(['github'], d, { required: [] });
      expect(results[0].outcome).toBe('skipped');
    });
  });

  describe('HTTP provider checks', () => {
    it('anthropic: unauthorized on 401', async () => {
      const d = deps({
        env: { ANTHROPIC_API_KEY: 'sk-ant-bad' },
        fetch: fakeFetch([{ match: 'api.anthropic.com', status: 401 }]),
      });
      const res = await checkOne('anthropic', d);
      expect(res.outcome).toBe('fail');
      expect(res.var).toBe('ANTHROPIC_API_KEY');
      expect(res.reason).toBe('unauthorized');
    });

    it('anthropic: ok on 200', async () => {
      const d = deps({
        env: { ANTHROPIC_API_KEY: 'sk-ant-good' },
        fetch: fakeFetch([{ match: 'api.anthropic.com', status: 200 }]),
      });
      expect((await checkOne('anthropic', d)).outcome).toBe('ok');
    });

    it('cloudflare: revoked token (account endpoint 401) surfaces as fail (WIC-869 class)', async () => {
      const d = deps({
        env: { CLOUDFLARE_API_TOKEN: 'cf-dead', CLOUDFLARE_ACCOUNT_ID: 'acct123' },
        fetch: fakeFetch([{ match: '/accounts/acct123/tokens/verify', status: 401 }]),
      });
      const res = await checkOne('cloudflare', d);
      expect(res.outcome).toBe('fail');
      expect(res.reason).toBe('unauthorized');
      expect(res.var).toBe('CLOUDFLARE_API_TOKEN');
    });

    it('cloudflare: account-scoped least-privilege token is OK even though /user/tokens/verify would 401 (WIC-903)', async () => {
      // The correct CI deploy token is account-scoped and 401s on the user endpoint.
      // With an account id known, we verify against the account endpoint instead.
      const d = deps({
        env: { CLOUDFLARE_API_TOKEN: 'cf-scoped', CLOUDFLARE_ACCOUNT_ID: 'acct123' },
        fetch: fakeFetch([
          { match: '/user/tokens/verify', status: 401 }, // would be a false positive
          {
            match: '/accounts/acct123/tokens/verify',
            status: 200,
            body: { success: true, result: { status: 'active' } },
          },
        ]),
      });
      const res = await checkOne('cloudflare', d);
      expect(res.outcome).toBe('ok');
      expect(res.var).toBe('CLOUDFLARE_API_TOKEN');
      // The user endpoint must not be consulted when an account id is available.
      expect(d.fetch as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
        expect.stringContaining('/user/tokens/verify'),
        expect.anything()
      );
    });

    it('cloudflare: account endpoint 200 but token disabled → fail token-inactive', async () => {
      const d = deps({
        env: { CLOUDFLARE_API_TOKEN: 'cf-disabled', CLOUDFLARE_ACCOUNT_ID: 'acct123' },
        fetch: fakeFetch([
          {
            match: '/accounts/acct123/tokens/verify',
            status: 200,
            body: { success: true, result: { status: 'disabled' } },
          },
        ]),
      });
      const res = await checkOne('cloudflare', d);
      expect(res.outcome).toBe('fail');
      expect(res.reason).toBe('token-inactive');
    });

    it('cloudflare: no account id + user endpoint 401 → advisory skip, NOT fail (WIC-903 never punish least-privilege)', async () => {
      const d = deps({
        env: { CLOUDFLARE_API_TOKEN: 'cf-scoped' },
        fetch: fakeFetch([{ match: '/user/tokens/verify', status: 401 }]),
      });
      const res = await checkOne('cloudflare', d);
      expect(res.outcome).toBe('skipped');
      expect(res.reason).toBe('advisory-unverified');
    });

    it('cloudflare: no account id + user endpoint 200 → ok', async () => {
      const d = deps({
        env: { CLOUDFLARE_API_TOKEN: 'cf-global' },
        fetch: fakeFetch([{ match: '/user/tokens/verify', status: 200 }]),
      });
      expect((await checkOne('cloudflare', d)).outcome).toBe('ok');
    });

    it('supabase: deleted/paused project (network error) blames SUPABASE_URL', async () => {
      const d = deps({
        env: { SUPABASE_URL: 'https://gone.supabase.co', SUPABASE_ANON_KEY: 'anon' },
        fetch: fakeFetch([{ match: 'gone.supabase.co', throws: 'FetchError' }]),
      });
      const res = await checkOne('supabase', d);
      expect(res.outcome).toBe('fail');
      expect(res.var).toBe('SUPABASE_URL');
      expect(res.reason).toBe('network-error');
    });

    it('supabase: bad anon key blames SUPABASE_ANON_KEY', async () => {
      const d = deps({
        env: { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'bad' },
        fetch: fakeFetch([{ match: 'p.supabase.co', status: 401 }]),
      });
      const res = await checkOne('supabase', d);
      expect(res.outcome).toBe('fail');
      expect(res.var).toBe('SUPABASE_ANON_KEY');
    });

    it('twilio: ok with valid basic auth', async () => {
      const d = deps({
        env: { TWILIO_ACCOUNT_SID: 'ACxxxx', TWILIO_AUTH_TOKEN: 'tok' },
        fetch: fakeFetch([{ match: 'api.twilio.com', status: 200 }]),
      });
      expect((await checkOne('twilio', d)).outcome).toBe('ok');
    });
  });

  describe('configured-vs-required semantics', () => {
    it('skips an unconfigured optional provider', async () => {
      const { results } = await runPreflight(['anthropic'], deps({ env: {} }), { required: [] });
      expect(results[0].outcome).toBe('skipped');
      expect(results[0].reason).toBe('not-configured');
    });

    it('fails an unconfigured required provider with missing-var', async () => {
      const { results } = await runPreflight(['anthropic'], deps({ env: {} }), {
        required: ['anthropic'],
      });
      expect(results[0].outcome).toBe('fail');
      expect(results[0].reason).toBe('missing-var');
      expect(results[0].var).toBe('ANTHROPIC_API_KEY');
    });
  });

  describe('aggregation and formatting', () => {
    it('runPreflight is not ok when any provider fails', async () => {
      const d = deps({
        env: {
          ANTHROPIC_API_KEY: 'good',
          CLOUDFLARE_API_TOKEN: 'dead',
          CLOUDFLARE_ACCOUNT_ID: 'acct123',
        },
        fetch: fakeFetch([
          { match: 'api.anthropic.com', status: 200 },
          { match: '/accounts/acct123/tokens/verify', status: 403 },
        ]),
      });
      const { ok, results } = await runPreflight(['anthropic', 'cloudflare'], d);
      expect(ok).toBe(false);
      expect(results.map((r) => r.outcome)).toEqual(['ok', 'fail']);
    });

    it('formatResultLine is greppable and never leaks the secret value', async () => {
      const d = deps({
        env: { GITHUB_TOKEN: 'ghp_SUPERSECRET_VALUE' },
        fetch: fakeFetch([{ match: 'api.github.com', status: 401 }]),
      });
      const res = await checkOne('github', d);
      const line = formatResultLine(res);
      expect(line).toContain('CREDENTIAL_PRECHECK_FAIL');
      expect(line).toContain('provider=github');
      expect(line).toContain('var=GITHUB_TOKEN');
      expect(line).toContain('reason=unauthorized');
      expect(line).not.toContain('ghp_SUPERSECRET_VALUE');
    });
  });
});
