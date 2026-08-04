import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { track, _resetAnalyticsSink } from '../src/services/analytics.service.js';
import { _resetConfig } from '../src/config.js';

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _resetConfig();
  _resetAnalyticsSink();
}

describe('analytics.service track()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    setEnv({ ANALYTICS_SINK: undefined, POSTHOG_API_KEY: undefined, POSTHOG_HOST: undefined });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetConfig();
    _resetAnalyticsSink();
    vi.restoreAllMocks();
  });

  it('defaults to the noop sink and emits nothing to the console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await track('resume_upload_submitted', { file_type: 'pdf', file_size_bytes: 10 }, 'sess-1');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('uses the console sink when ANALYTICS_SINK=console', async () => {
    setEnv({ ANALYTICS_SINK: 'console' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await track('resume_upload_completed', { resume_id: 'r1', sections_detected: 4 }, 'sess-2');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain('resume_upload_completed');
    expect(line).toContain('session=sess-2');
    expect(line).toContain('r1');
  });

  it('falls back to noop when ANALYTICS_SINK=posthog but no API key is set', async () => {
    setEnv({ ANALYTICS_SINK: 'posthog', POSTHOG_API_KEY: undefined });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await track('resume_upload_failed', { error_stage: 'extraction' }, null);
    expect(warnSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('sends to PostHog via fetch when ANALYTICS_SINK=posthog and a key is set', async () => {
    setEnv({
      ANALYTICS_SINK: 'posthog',
      POSTHOG_API_KEY: 'phc_test',
      POSTHOG_HOST: 'https://ph.example.com',
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    await track('resume_upload_completed', { resume_id: 'r9', file_type: 'pdf' }, 'sess-9');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://ph.example.com/capture/');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.api_key).toBe('phc_test');
    expect(payload.event).toBe('resume_upload_completed');
    expect(payload.distinct_id).toBe('sess-9');
    expect(payload.properties.session_id).toBe('sess-9');
    expect(payload.properties.resume_id).toBe('r9');
  });

  it('never throws even when the underlying sink fails', async () => {
    setEnv({
      ANALYTICS_SINK: 'posthog',
      POSTHOG_API_KEY: 'phc_test',
      POSTHOG_HOST: 'https://ph.example.com',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      track('resume_upload_submitted', { file_type: 'pdf' }, 'sess-x')
    ).resolves.toBeUndefined();
  });
});
