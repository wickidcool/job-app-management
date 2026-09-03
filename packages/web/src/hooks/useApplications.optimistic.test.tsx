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

/**
 * WIC-1570: `totalCount` and `truncated` are explicit, and the truncated seed
 * below sets `totalCount` **larger than `applications.length`**.
 *
 * The old helper derived `totalCount: applications.length` and hardcoded
 * `truncated: false`, which made the collection metadata untestable: the drift
 * `totalCount: collection.applications.length` inside the updater rendered the
 * same value the seed did, so the whole suite stayed green with the account
 * total silently replaced by the row count. This helper is the load-bearing
 * half of the two assertions in `AC-1: carries the collection metadata …`.
 */
function makeCollection(
  applications: Application[],
  meta: Pick<ApplicationCollection, 'totalCount' | 'truncated'>
): ApplicationCollection {
  return { applications, ...meta };
}

/**
 * The truncated collection's metadata. `ApplicationsList` renders this pair as
 * "Showing the first {rows} of {totalCount} applications" behind a `truncated`
 * guard — so a drift in either field turns a partial view into a complete-
 * looking one for the width of every in-flight status change.
 */
const ACTIVE_META = { totalCount: 137, truncated: true } as const;
const SEARCH_META = { totalCount: 1, truncated: false } as const;

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

function collectionIn(client: QueryClient, filters: unknown) {
  return client.getQueryData<ApplicationCollection>(applicationKeys.list(filters));
}

function rowIn(client: QueryClient, filters: unknown, id: string) {
  return collectionIn(client, filters)?.applications.find((app) => app.id === id);
}

function statusIn(client: QueryClient, filters: unknown, id: string) {
  return rowIn(client, filters, id)?.status;
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  // Two list queries under two different filters, both holding the same row —
  // exactly the shape the Kanban board and the list page produce together.
  //
  // The two differ in their metadata on purpose: one collection is a truncated
  // prefix of a larger account, the other is complete. A patch that hardcoded
  // either value would be right about one of them and wrong about the other.
  queryClient.setQueryData<ApplicationCollection>(
    applicationKeys.list(FILTER_ACTIVE),
    makeCollection(
      [makeApplication(), makeApplication({ id: 'app-2', status: 'saved' })],
      ACTIVE_META
    )
  );
  queryClient.setQueryData<ApplicationCollection>(
    applicationKeys.list(FILTER_SEARCH),
    makeCollection([makeApplication()], SEARCH_META)
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

  // WIC-1570. Not an assertion about the hook: it is the negative control for the
  // two tests below. `totalCount` is only distinguishable from `applications.length`
  // if the seed makes them differ, and `truncated` is only distinguishable from a
  // hardcoded literal if both values appear somewhere in the fixture. Weakening
  // `makeCollection` back to `totalCount: applications.length, truncated: false`
  // fails here, before it can quietly de-fang anything else.
  it('the seed distinguishes collection metadata from row data — the discriminator', () => {
    const { queryClient } = setup();

    const active = collectionIn(queryClient, FILTER_ACTIVE);
    const search = collectionIn(queryClient, FILTER_SEARCH);

    expect(active?.totalCount).toBeGreaterThan(active?.applications.length ?? 0);
    expect(active?.truncated).toBe(true);
    expect(search?.truncated).toBe(false);
  });

  it('AC-1: carries the collection metadata through the patch', async () => {
    const pending = deferred<Application>();
    vi.mocked(applicationService.updateStatus).mockReturnValue(pending.promise);

    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ id: 'app-1', status: 'interview', version: 3 });
    });

    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('interview');
    });

    // The `...collection` spread is what preserves these; nothing else asserted
    // that it does. `ApplicationsList` reads exactly this pair to decide whether
    // to show "Showing the first 2 of 137 applications" — so a drift to
    // `totalCount: collection.applications.length` (type-safe, so `tsc` is
    // silent) would make a truncated view read as complete for the width of the
    // in-flight request, and a drift on `truncated` would delete the notice.
    expect(collectionIn(queryClient, FILTER_ACTIVE)?.totalCount).toBe(ACTIVE_META.totalCount);
    expect(collectionIn(queryClient, FILTER_ACTIVE)?.truncated).toBe(true);

    // ...and the complete collection stays complete, so neither field can be
    // satisfied by a hardcoded literal.
    expect(collectionIn(queryClient, FILTER_SEARCH)?.totalCount).toBe(SEARCH_META.totalCount);
    expect(collectionIn(queryClient, FILTER_SEARCH)?.truncated).toBe(false);

    pending.resolve(makeApplication({ status: 'interview', version: 4 }));
  });

  it('AC-1: advances `updatedAt` on the moved row', async () => {
    const pending = deferred<Application>();
    vi.mocked(applicationService.updateStatus).mockReturnValue(pending.promise);

    const { queryClient, result } = setup();
    const seeded = rowIn(queryClient, FILTER_ACTIVE, 'app-1')?.updatedAt;
    const beforeMutate = Date.now();

    act(() => {
      result.current.mutate({ id: 'app-1', status: 'interview', version: 3 });
    });

    await waitFor(() => {
      expect(statusIn(queryClient, FILTER_ACTIVE, 'app-1')).toBe('interview');
    });

    // `...app` supplies the stale `updatedAt`, so dropping `updatedAt: new Date()`
    // from the optimistic row is type-clean and was invisible to this suite.
    // `ApplicationsList.calculatePipelineStats` derives its "Stale (14+ days)"
    // count from this field, so without it a card the user has just moved keeps
    // counting as stale until `onSettled` refetches.
    const patched = rowIn(queryClient, FILTER_ACTIVE, 'app-1')?.updatedAt;
    expect(patched?.getTime()).toBeGreaterThanOrEqual(beforeMutate);
    expect(patched?.getTime()).toBeGreaterThan(seeded?.getTime() ?? 0);

    // The row that did not move keeps its original timestamp.
    expect(rowIn(queryClient, FILTER_ACTIVE, 'app-2')?.updatedAt.getTime()).toBe(seeded?.getTime());

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
