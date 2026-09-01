import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APIClient } from './apiClient';
import { CoverLetterService } from './coverLetters';
import { TARGETED_LIST_PAGE_MAX } from '../../constants/applicationMatch';

/**
 * WIC-1533 — the second half of the page-cap guard.
 *
 * `ApplicationDetail.coverLetters.test.tsx` proves the *page* asks for
 * `limit: TARGETED_LIST_PAGE_MAX`. This proves that asking for it actually puts
 * `limit=100` on the wire, rather than the parameter being accepted by a type
 * and dropped somewhere between the service and the query string.
 *
 * It is asserted on the **request URL**, which is the one representation in the
 * chain that cannot be satisfied by an object nobody serialises. Note this test
 * is deliberately weak against one specific mutation: `list` forwards `params`
 * to `client.get` wholesale, so narrowing its parameter *type* would not change
 * runtime behaviour and would not red this file — TypeScript's excess-property
 * check on the `ApplicationDetail` call site is what binds that link. The two
 * tests plus `npm run typecheck` close the chain; neither test does alone, and
 * the measured control results are recorded on the PR rather than implied.
 */
function makeService() {
  const client = new APIClient({
    baseURL: 'https://api.test/api',
    getAuthToken: async () => 'token',
  });
  return new CoverLetterService(client);
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ coverLetters: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('coverLetterService.list — page size reaches the request', () => {
  it('sends the requested limit as a query parameter', async () => {
    await makeService().list({ company: 'Acme', limit: TARGETED_LIST_PAGE_MAX });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/cover-letters');
    expect(url.searchParams.get('company')).toBe('Acme');
    expect(url.searchParams.get('limit')).toBe('100');
  });

  /**
   * The negative half: with no limit the parameter is absent, so the server
   * applies its own default of 20. This is what `ApplicationDetail` used to do
   * and what the page cap exists to stop it doing — asserting the *absence*
   * keeps the test above from passing for the trivial reason that `limit` is
   * always sent regardless of the caller.
   */
  it('omits limit entirely when the caller does not ask for one', async () => {
    await makeService().list({ company: 'Acme' });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.has('limit')).toBe(false);
  });

  /**
   * The constant is the endpoint's documented maximum
   * (`listQuerySchema`: `.max(100)`). If someone raises it chasing the residual
   * described in `applicationMatch.ts`, every request 400s at runtime while the
   * suite stays green — so pin it here, where the value is about to be
   * serialised into a request the server validates.
   */
  it('requests no more than the endpoint accepts', () => {
    expect(TARGETED_LIST_PAGE_MAX).toBeLessThanOrEqual(100);
    expect(TARGETED_LIST_PAGE_MAX).toBeGreaterThan(20);
  });
});
