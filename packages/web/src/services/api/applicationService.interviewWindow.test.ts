import { describe, expect, it, vi } from 'vitest';

import { ApplicationService } from './applicationService';
import type { APIClient } from './apiClient';
import { interviewWeekWindow } from '../../utils/interviewWeek';

/**
 * WIC-2194 — the client half of the interview-date window.
 *
 * `buildListQuery` appended only `status`/`company`/`search`/`limit`/`page`, so the
 * `interviewDateFrom`/`interviewDateTo` capability WIC-2189 shipped, validated and tested
 * on the server was **unreachable from any client**. This file pins the request that
 * closes that gap.
 *
 * The companion pin is `packages/api/test/application-interview-date-query.test.ts`,
 * which asserts the *server* accepts this exact string shape. Two files on purpose: a
 * single test that mocked one side would go green on a contract change that breaks the
 * other, and this is precisely a two-sided fix — the caller builds the instant, the callee
 * validates it, and either can drift.
 */

function captureClient() {
  const urls: string[] = [];
  const client = {
    get: vi.fn(async (url: string) => {
      urls.push(url);
      return { applications: [], totalCount: 0 };
    }),
  } as unknown as APIClient;

  return { client, urls };
}

describe('buildListQuery — interview-date bounds', () => {
  it('sends both bounds when the filter carries a window', async () => {
    const { client, urls } = captureClient();

    await new ApplicationService(client).getAllPaged({
      status: ['interview', 'phone_screen'],
      interviewDateFrom: '2026-09-07T00:00:00.000+02:00',
      interviewDateTo: '2026-09-13T23:59:59.999+02:00',
    });

    const params = new URLSearchParams(urls[0].split('?')[1]);
    expect(params.get('interviewDateFrom')).toBe('2026-09-07T00:00:00.000+02:00');
    expect(params.get('interviewDateTo')).toBe('2026-09-13T23:59:59.999+02:00');
  });

  /**
   * The `+` in a `+02:00` offset is the character that makes hand-built query strings
   * wrong: unescaped it decodes as a space, so `+02:00` arrives as ` 02:00` and the bound
   * either 400s or shifts by two hours. `URLSearchParams` escapes it; a template literal
   * would not. This asserts the escaping is really happening rather than trusting it.
   */
  it('percent-escapes the offset sign rather than emitting a bare +', async () => {
    const { client, urls } = captureClient();

    await new ApplicationService(client).getAllPaged({
      interviewDateFrom: '2026-09-07T00:00:00.000+02:00',
    });

    expect(urls[0]).toContain('interviewDateFrom=2026-09-07T00%3A00%3A00.000%2B02%3A00');
    expect(urls[0]).not.toContain('.000+02:00');
  });

  it('omits the params entirely when no window is set', async () => {
    const { client, urls } = captureClient();

    await new ApplicationService(client).getAllPaged({ status: ['applied'] });

    expect(urls[0]).not.toContain('interviewDateFrom');
    expect(urls[0]).not.toContain('interviewDateTo');
  });

  it('carries the bounds onto every page, not just the first', async () => {
    // A window dropped after page 1 would silently widen the result set for anyone with
    // more than one page of interviews — and the extra rows would look like a correct
    // answer, since they are real applications.
    const urls: string[] = [];
    const client = {
      get: vi.fn(async (url: string) => {
        urls.push(url);
        return {
          applications: [],
          totalCount: 0,
          nextPage: urls.length < 2 ? 'cursor-1' : undefined,
        };
      }),
    } as unknown as APIClient;

    await new ApplicationService(client).getAllPaged({
      interviewDateFrom: '2026-09-07T00:00:00.000Z',
      interviewDateTo: '2026-09-13T23:59:59.999Z',
    });

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain('interviewDateFrom');
      expect(url).toContain('interviewDateTo');
    }
    expect(urls[1]).toContain('page=cursor-1');
  });

  /**
   * The end-to-end shape: what `interviewWeekWindow` builds must be what the query
   * carries, unmodified. This is the seam where a "helpful" `.split('T')[0]` or a
   * `toLocaleDateString` would turn a working filter into a 400.
   */
  it('forwards what interviewWeekWindow builds, byte for byte', async () => {
    const { client, urls } = captureClient();
    const window = interviewWeekWindow(new Date(2026, 8, 9, 14, 30, 0, 0));

    await new ApplicationService(client).getAllPaged({
      interviewDateFrom: window.from,
      interviewDateTo: window.to,
    });

    const params = new URLSearchParams(urls[0].split('?')[1]);
    expect(params.get('interviewDateFrom')).toBe(window.from);
    expect(params.get('interviewDateTo')).toBe(window.to);
    // …and what it built is an instant, not a calendar day. A date-only bound is a 400.
    expect(params.get('interviewDateFrom')).toContain('T00:00:00.000');
  });
});
