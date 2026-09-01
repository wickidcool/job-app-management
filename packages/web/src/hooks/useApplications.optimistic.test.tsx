import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { applicationKeys, useUpdateApplicationStatus } from './useApplications';
import { applicationService } from '../services/api';
import type { ApplicationCollection } from '../services/api/applicationService';
import type { Application } from '../types/application';

/**
 * WIC-1497 regression suite — the optimistic list patch in
 * `useUpdateApplicationStatus().onMutate`.
 *
 * The defect: the snapshot read `queryClient.getQueryData(applicationKeys.lists())`.
 * `lists()` is `['applications', 'list']`, but a list query registers under
 * `list(filters)` = `['applications', 'list', filters]`, and `getQueryData` is
 * **exact-match** (prefix matching is `getQueriesData` / `setQueriesData`). So the
 * snapshot was always `undefined`, the `if` never fired, and the paired
 * `setQueryData(lists(), ...)` would have written to a key nothing reads. Dragging a
 * Kanban card between columns had no optimistic feedback at all, and the `onError`
 * rollback was dead for the same reason.
 *
 * Why this survived: `onSettled` invalidates and refetches, so the *final* state is
 * always correct. Any test that awaits the mutation passes on the broken code. Every
 * assertion below is therefore taken **while the request is still in flight** — the
 * mutation is backed by a deferred that this file resolves by hand (AC-3).
 */

const FILTER_ACTIVE = { status: ['applied' as const] };
const FILTER_SEARCH = { search: 'acme' };

function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    jobTitle: 'Staff Engineer',
    company: 'Acme',
    status: 'applied',
    hasDocuments: false,
    version: 3,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-10T00:00:00Z'),
    ...overrides,
  };
}

function makeCollection(applications: Application[]): ApplicationCollection {
  return { applications, totalCount: applications.length, truncated: false };
}

/** A promise this test resolves/rejects by hand, so the in-flight window is ours. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function statusIn(client: QueryClient, filters: unknown, id: string) {
  return client
    .getQueryData<ApplicationCollection>(applicationKeys.list(filters))
    ?.applications.find((app) => app.id === id)?.status;
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  // Two list queries under two different filters, both holding the same row —
  // exactly the shape the Kanban board and the list page produce together.
  queryClient.setQueryData<ApplicationCollection>(
    applicationKeys.list(FILTER_ACTIVE),
    makeCollection([makeApplication(), makeApplication({ id: 'app-2', status: 'saved' })])
  );
  queryClient.setQueryData<ApplicationCollection>(
    applicationKeys.list(FILTER_SEARCH),
    makeCollection([makeApplication()])
  );
  queryClient.setQueryData<Application>(applicationKeys.detail('app-1'), makeApplication());

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useUpdateApplicationStatus(), { wrapper });
  return { queryClient, result };
}

describe('useUpdateApplicationStatus optimistic list patch (WIC-1497)', () => {
  beforeEach(() => {
    vi.spyOn(applicationService, 'updateStatus');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-1: moves the row to its new status before the request resolves', async () => {
    const pending = deferred<Application>();
    vi.mocked(applicationService.updateStatus).mockReturnValue(pending.promise);

    const { queryClient, result } = setup();
    expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('applied');

    act(() => {
      result.current.mutate({ id: 'app-1', status: 'interview', version: 3 });
    });

    // Still in flight — `pending` has not been resolved and never will be inside
    // this assertion, so anything observed here is the optimistic patch.
    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('interview');
    });
    expect(result.current.isPending).toBe(true);

    pending.resolve(makeApplication({ status: 'interview', version: 4 }));
  });

  it('AC-1: patches every list query in the cache, not just one', async () => {
    const pending = deferred<Application>();
    vi.mocked(applicationService.updateStatus).mockReturnValue(pending.promise);

    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ id: 'app-1', status: 'offer', version: 3 });
    });

    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('offer');
    });
    expect(statusIn(queryClient, FILTER_SEARCH, 'app-1')).toBe('offer');

    pending.resolve(makeApplication({ status: 'offer', version: 4 }));
  });

  it('AC-1: leaves other rows and the bare `lists()` key alone', async () => {
    const pending = deferred<Application>();
    vi.mocked(applicationService.updateStatus).mockReturnValue(pending.promise);

    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ id: 'app-1', status: 'offer', version: 3 });
    });

    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('offer');
    });

    // The sibling row in the same collection is untouched...
    expect(statusIn(queryClient, FILTER_ACTIVE, 'app-2')).toBe('saved');
    // ...and nothing is written to `['applications', 'list']` itself, which is the
    // key the defective implementation both read from and wrote to. A cache entry
    // appearing there means the prefix/exact-match confusion has come back.
    expect(queryClient.getQueryData(applicationKeys.lists())).toBeUndefined();

    pending.resolve(makeApplication({ status: 'offer', version: 4 }));
  });

  it('AC-1: bumps the optimistic version so the detail and list agree', async () => {
    const pending = deferred<Application>();
    vi.mocked(applicationService.updateStatus).mockReturnValue(pending.promise);

    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ id: 'app-1', status: 'interview', version: 3 });
    });

    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('interview');
    });

    const listRow = queryClient
      .getQueryData<ApplicationCollection>(applicationKeys.list(FILTER_ACTIVE))
      ?.applications.find((app) => app.id === 'app-1');
    const detail = queryClient.getQueryData<Application>(applicationKeys.detail('app-1'));

    expect(listRow?.version).toBe(4);
    expect(detail?.version).toBe(4);
    expect(detail?.status).toBe('interview');

    pending.resolve(makeApplication({ status: 'interview', version: 4 }));
  });

  it('AC-2: a failed mutation rolls every patched list back, not just one', async () => {
    const pending = deferred<Application>();
    vi.mocked(applicationService.updateStatus).mockReturnValue(pending.promise);

    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ id: 'app-1', status: 'rejected', version: 3 });
    });

    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('rejected');
    });
    expect(statusIn(queryClient, FILTER_SEARCH, 'app-1')).toBe('rejected');

    await act(async () => {
      pending.reject(new Error('409 version conflict'));
      await pending.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Both lists — the rollback must restore every entry the patch touched.
    // These queries have no observers, so `onSettled`'s invalidation cannot
    // refetch them; what is asserted here is the rollback itself.
    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('applied');
    });
    expect(statusIn(queryClient, FILTER_SEARCH, 'app-1')).toBe('applied');
    expect(queryClient.getQueryData<Application>(applicationKeys.detail('app-1'))?.status).toBe(
      'applied'
    );
  });
});
