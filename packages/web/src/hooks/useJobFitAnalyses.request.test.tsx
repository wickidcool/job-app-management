import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useJobFitAnalyses } from './useJobFitAnalysis';
import { apiClient } from '../services/api';

/**
 * WIC-1835 — the analyses filter, asserted on the request URL.
 *
 * `ApplicationDetail.workflowChecklist.test.tsx` proves the *page* asks for
 * `applicationId`. It asserts on `vi.mocked(useJobFitAnalyses)`, so it stops at
 * the hook call. This proves the ask survives the two layers below it — the
 * hook's `queryFn` and `jobFitService.listAnalyses` — and lands on the wire,
 * which is the one representation in the chain that cannot be satisfied by an
 * object nobody serialises (`coverLetters.list.test.ts`, WIC-1533).
 *
 * `npm run typecheck` does not close either link. `client.get`'s `params` are
 * optional and `listAnalyses`' are too, so a service that stops forwarding
 * `applicationId`, and a `queryFn` that calls `listAnalyses()` with no params at
 * all, both compile cleanly under the strict web build. Unfiltered, the endpoint
 * drops to the owner term alone and still returns the newest row — so every
 * application's checklist would tick, and badge, one foreign analysis. That is
 * strictly worse than the unticked state this card set out to fix.
 *
 * The path is derived from `apiClient.config.baseURL` rather than written as a
 * literal `/api`: the prefix is `import.meta.env.VITE_API_BASE_URL || '/api'`,
 * so hardcoding it would red this file for anyone holding a local `.env`, for a
 * reason that has nothing to do with the filter. The endpoint suffix is still
 * pinned exactly, which is what catches a path typo.
 */
const ANALYSES_PATH = new URL(
  `${apiClient.config.baseURL}/catalog/job-fit/analyses`,
  'https://api.test'
).pathname;

const fetchMock = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function requestedUrl(): Promise<URL> {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return new URL(fetchMock.mock.calls[0]![0] as string, 'https://api.test');
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ analyses: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WIC-1835 AC-2 — useJobFitAnalyses puts the filter on the wire', () => {
  it('sends applicationId and limit as query parameters', async () => {
    renderHook(() => useJobFitAnalyses({ applicationId: 'app_1', limit: 1 }), { wrapper });

    const url = await requestedUrl();
    expect(url.pathname).toBe(ANALYSES_PATH);
    expect(url.searchParams.get('applicationId')).toBe('app_1');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  /**
   * The negative half. Without it the case above is satisfied by a service that
   * pins `applicationId` to a constant — and the unfiltered flow is a supported
   * one, not a hypothetical: `application_id` is nullable, and an analysis run
   * from `/job-fit-analysis` with no `appId` belongs to no application at all.
   */
  it('omits both entirely when the caller asks for neither', async () => {
    renderHook(() => useJobFitAnalyses(), { wrapper });

    const url = await requestedUrl();
    expect(url.pathname).toBe(ANALYSES_PATH);
    expect(url.searchParams.has('applicationId')).toBe(false);
    expect(url.searchParams.has('limit')).toBe(false);
  });
});
