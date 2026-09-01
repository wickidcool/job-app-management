import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApplicationsList } from './ApplicationsList';
import { MAX_APPLICATION_PAGES } from '../services/api/applicationService';
import type { APIApplication } from '../services/api/types';

/**
 * WIC-1570 / WIC-1478 AC-N1b, second limb — the *rendering* half of
 * "either it paginates to exhaustion or it renders that the view is partial".
 *
 * `getAllPaged` computing `truncated` is pinned by
 * `applicationService.pagination.test.ts`. Nothing pinned `ApplicationsList`
 * *showing* it: deleting the notice outright (`{isPartialView && (` →
 * `{false && (`) left the whole workspace suite green.
 *
 * The load-bearing half of these tests is the fixture, not the assertion. The
 * server is stubbed so that the number of rows the page holds and the number of
 * rows the account has are **different** (50 vs 137). Against a fixture where
 * `totalCount === applications.length` — which is what every other web fixture
 * in this package used before this file — a notice that printed the row count
 * where the total belongs would be indistinguishable from a correct one.
 *
 * Nothing is mocked below the network boundary: `fetch` is stubbed and the real
 * `apiClient`, `applicationService.getAllPaged`, `useApplicationCollection` and
 * page component run on top of it.
 */

/** Rows the server reports for the filter — deliberately not a multiple of anything. */
const SERVER_TOTAL = 137;
/**
 * Rows the page can actually hold. One row per page × the page budget: this is
 * the only way to reach `truncated: true` without seeding 5,000 applications,
 * and it is exactly the condition the flag exists to report.
 */
const ROWS_HELD = MAX_APPLICATION_PAGES;

function makeRow(i: number): APIApplication {
  const stamp = new Date(Date.UTC(2026, 7, 20, 0, 0, i)).toISOString();
  return {
    id: `app-${String(i).padStart(3, '0')}`,
    jobTitle: `Engineer ${i}`,
    company: `Company ${i}`,
    status: 'applied',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * A server with `pages` pages of one row each.
 *
 * When `pages` exceeds the client's page budget the cursor is still outstanding
 * when `getAllPaged` gives up, which is the truncated case. When it does not,
 * the last page omits `nextPage` and the collection is complete.
 */
function installFetchStub(pages: number, totalCount: number) {
  const requests: { path: string; page: string | null }[] = [];

  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    requests.push({ path: url.pathname, page: url.searchParams.get('page') });

    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.pathname.endsWith('/applications')) {
      const offset = Number(url.searchParams.get('page') ?? 0);
      const isLast = offset + 1 >= pages;
      return json({
        applications: [makeRow(offset)],
        nextPage: isLast ? undefined : String(offset + 1),
        totalCount,
      });
    }

    return json({});
  });

  vi.stubGlobal('fetch', stub);
  return requests;
}

function renderApplicationsList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ApplicationsList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Every `role="status"` on the page that actually says something.
 *
 * `KanbanBoard` mounts a permanently-empty `role="status"` announcer for drag
 * feedback, so a bare `getByRole('status')` matches two nodes and throws. The
 * empty one is filtered out here rather than the notice being looked up by its
 * copy, so that "the partial view is announced" stays an assertion about the
 * *role* — the a11y contract — and not just about the words.
 */
function spokenStatuses(): HTMLElement[] {
  return screen.getAllByRole('status').filter((el) => (el.textContent ?? '').trim().length > 0);
}

function normalise(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('ApplicationsList partial-view notice (WIC-1570)', () => {
  beforeEach(() => {
    localStorage.setItem('auth_token', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('the fixture is one where the row count and the total differ — the discriminator', () => {
    // Not an assertion about the component. If these two were equal, a notice
    // that printed `applications.length` where `totalCount` belongs would read
    // correctly and the test below could not fail.
    expect(ROWS_HELD).toBeGreaterThan(0);
    expect(SERVER_TOTAL).toBeGreaterThan(ROWS_HELD);
  });

  it('announces that the view is partial when the collection is truncated', async () => {
    installFetchStub(SERVER_TOTAL, SERVER_TOTAL);
    renderApplicationsList();

    // Waits for the page to have finished paging before anything is counted.
    const notice = await screen.findByText(/Showing the first/i);
    const spoken = spokenStatuses();

    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContainElement(notice.closest('[role="status"]'));
  });

  it('names the account total, not the number of rows it happens to hold', async () => {
    installFetchStub(SERVER_TOTAL, SERVER_TOTAL);
    renderApplicationsList();

    await screen.findByText(/Showing the first/i);
    const text = normalise(spokenStatuses()[0]!);

    // Both numbers, in their own roles. `Showing the first 137 of 137` — the
    // shape a `totalCount: applications.length` drift produces — fails the
    // first clause; `the first 50 of 50` fails the second.
    expect(text).toContain(`Showing the first ${ROWS_HELD} of ${SERVER_TOTAL} applications`);
    expect(text).not.toContain(`of ${ROWS_HELD} applications`);
  });

  it('stops paging at the page budget rather than following the cursor forever', async () => {
    const requests = installFetchStub(SERVER_TOTAL, SERVER_TOTAL);
    renderApplicationsList();

    await screen.findByText(/Showing the first/i);

    // The server offered 137 pages; the client took exactly its budget. This is
    // what makes the notice honest rather than incidental — without the bound
    // there would be no partial view to announce.
    expect(requests.filter((r) => r.path.endsWith('/applications'))).toHaveLength(
      MAX_APPLICATION_PAGES
    );
  });

  it('says nothing when the collection is complete', async () => {
    // Three pages, then the cursor runs out: complete, so `truncated` is false.
    installFetchStub(3, 3);
    renderApplicationsList();

    // The board renders once the query settles; the announcer proves we are
    // past the loading skeleton, which mounts no `role="status"` at all.
    await screen.findByRole('region', { name: 'Kanban board' });

    expect(spokenStatuses()).toHaveLength(0);
    expect(screen.queryByText(/Showing the first/i)).not.toBeInTheDocument();
  });
});
