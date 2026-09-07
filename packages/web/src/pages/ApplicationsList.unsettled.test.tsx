import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationsList } from './ApplicationsList';
import type { Application } from '../types/application';

/**
 * WIC-2229 — the WIC-2227 class on the applications board.
 *
 * `ApplicationsList` read `const { data: collection, isLoading }` and had **no `isError`
 * reference anywhere in the file**. `data` is `undefined` in three states — pending, paused
 * and failed — so a failed `getAllPaged` rendered the account as measured-empty on two
 * surfaces at once:
 *
 * 1. five pipeline tiles reading `Active 0 / Overdue 0 / Due Today 0 / Due Soon 0 / Stale 0`,
 *    which had no loading gate at all and so stated those figures *during* the request too;
 * 2. six board columns each saying "No <status> applications".
 *
 * `isPartialView` (`collection?.truncated ?? false`) correctly suppressed its own banner,
 * which made the page read as an authoritative complete view of an empty account.
 *
 * ## Why this file mocks the SERVICE and not the hook
 *
 * Copied from `ProjectsList.unsettled.test.tsx` for the same reason WIC-2179's review round
 * 1 gave: a `vi.mock` of `useApplicationCollection` whose `data` is derived from the same
 * flags the component branches on makes `data === undefined ⟺ isPending || isError` true by
 * construction. It would assert the fix's premise rather than test it, and it cannot produce
 * the paused state at all. So a real `QueryClient` drives the real hook and
 * `applicationService` is stubbed one layer lower.
 *
 * ## Why `queryFn` call counts are asserted
 *
 * A paused query and a slow one render identically. `toHaveBeenCalledTimes(0)` is the only
 * thing that proves `fetchStatus: "paused"` rather than an unresolved promise; `1` in the
 * failure case proves the request was really attempted and really rejected.
 */

const GET_ALL_PAGED = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    applicationService: {
      ...(actual.applicationService as object),
      getAllPaged: (...args: unknown[]) => GET_ALL_PAGED(...args),
    },
  };
});

/**
 * The claims under test.
 *
 * `SAVED_COLUMN_EMPTY` is one of six identical-shaped column claims; `OVERDUE_LABEL` is
 * chosen over `Active` because "Active" also appears in the filter panel's "Active only"
 * control, and an absence matcher that can be satisfied by a neighbouring control is not
 * measuring the tile.
 */
const SAVED_COLUMN_EMPTY = /No saved applications/i;
const OVERDUE_LABEL = /^Overdue$/;
const FAILURE_DISCLOSURE = /Failed to load your applications/i;

function anApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 'a1',
    jobTitle: 'Staff Engineer',
    company: 'Initech',
    status: 'saved',
    hasDocuments: false,
    version: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function aCollection(applications: Application[]) {
  return { applications, totalCount: applications.length, truncated: false };
}

function renderApplicationsList() {
  // `retry: false` keeps a rejection from retrying; it does not affect pausing, and no
  // `networkMode` is set because the default is the thing under test.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ApplicationsList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  GET_ALL_PAGED.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('ApplicationsList — an unread application list is not an empty one (WIC-2229)', () => {
  it('CONTROL: a settled EMPTY response still renders the zeros and the empty columns', async () => {
    // The state the page is ENTITLED to call empty. Without this the assertions below would
    // also pass for a page that had simply lost its pipeline tiles and its board.
    GET_ALL_PAGED.mockResolvedValue(aCollection([]));

    renderApplicationsList();

    // Wait on the TILE, not on the column copy. The columns are the first thing to appear
    // once the board stops skeletoning, so keying the wait on them let an intermediate
    // render satisfy it while the tile was still a placeholder — a mutation cell
    // (`loading={false}` on the board) reddened this control for a reason that had nothing
    // to do with what it measures. The tile settling is the actual precondition.
    await waitFor(() => {
      expect(screen.getByText(OVERDUE_LABEL).parentElement?.textContent).toContain('0');
    });
    // An honest measurement of an account with no rows.
    //
    // ⚠️ `findByText`, not `getByText` (WIC-2233). This control asserts TWO surfaces and the
    // wait above only covers one of them: re-anchoring it on the tile fixed the mutation
    // cell it was meant to fix, but left the column copy un-awaited, so under
    // `unsettled={false}` the tile settles on first render, the `waitFor` returns
    // immediately, and this line ran while `KanbanBoard` was still skeletoning. Green today
    // either way — it only surfaces under mutation. Wait on both surfaces you assert.
    expect(await screen.findByText(SAVED_COLUMN_EMPTY)).toBeTruthy();
    expect(screen.queryByText(FAILURE_DISCLOSURE)).toBeNull();
    expect(GET_ALL_PAGED).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a settled NON-EMPTY response renders the row and a non-zero Active tile', async () => {
    // Pins the other direction: the tiles are wired to the data at all, so a `0` above is a
    // measurement rather than a constant. Without this, a tile hardcoded to `0` would pass
    // every other case in this file.
    GET_ALL_PAGED.mockResolvedValue(aCollection([anApplication()]));

    renderApplicationsList();

    expect(await screen.findByText('Staff Engineer')).toBeTruthy();
    expect(screen.getByText(/^Active$/).parentElement?.textContent).toContain('1');
    expect(screen.queryByText(SAVED_COLUMN_EMPTY)).toBeNull();
  });

  it('a FAILED request discloses the failure instead of claiming the account is empty', async () => {
    GET_ALL_PAGED.mockRejectedValue(new Error('500'));

    renderApplicationsList();

    expect(await screen.findByText(FAILURE_DISCLOSURE)).toBeTruthy();
    // Both false-claim surfaces, named directly rather than inferred from the diff.
    expect(screen.queryByText(SAVED_COLUMN_EMPTY)).toBeNull();
    expect(screen.queryByText(OVERDUE_LABEL)).toBeNull();
    // The request really was attempted and really did fail.
    expect(GET_ALL_PAGED).toHaveBeenCalledTimes(1);
  });

  it('an offline-PAUSED query renders skeletons, not a zeroed pipeline', async () => {
    onlineManager.setOnline(false);
    // Deliberately resolvable: the user HAS an application. If a figure renders here, the
    // page is contradicting data the fixture proves exists.
    GET_ALL_PAGED.mockResolvedValue(aCollection([anApplication()]));

    renderApplicationsList();

    // Positive form rather than a bare absence: five loading placeholders is what the tiles
    // are supposed to be doing, and asserting it means an accidentally-unmounted stats bar
    // cannot pass this test the way `queryByText(...) === null` would.
    await waitFor(() => {
      expect(screen.getAllByRole('status', { name: /^Loading .+ count$/ })).toHaveLength(5);
    });
    expect(screen.queryByText(SAVED_COLUMN_EMPTY)).toBeNull();
    expect(screen.queryByText(FAILURE_DISCLOSURE)).toBeNull();
    // 0 calls is what makes this a PAUSED query rather than a merely slow one.
    expect(GET_ALL_PAGED).toHaveBeenCalledTimes(0);
  });
});
