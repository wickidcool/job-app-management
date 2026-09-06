import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';

/**
 * The state `CommandPalette.loadingState.test.tsx` structurally cannot see (WIC-2179,
 * review round 1).
 *
 * That file mocks `useApplicationCollection` and derives `data` from the same flags the
 * component branches on, so `data === undefined ⟺ isPending || isError` holds there **by
 * construction**. It therefore asserts the fix's own premise instead of testing it, and
 * any real query state that breaks the premise is invisible to every assertion in it.
 *
 * THERE IS SUCH A STATE, AND IT IS THE FIRST FIX'S BUG. The first version of this fix read
 * `isLoading || isError`. In react-query v5 `isLoading` is `isPending && isFetching`, so a
 * query that is **pending but paused** — `fetchStatus: "paused"`, which is precisely what
 * the default `networkMode: "online"` does the moment the browser reports itself offline —
 * has `isLoading === false`, `isError === false`, and `data === undefined`. The `= []`
 * default fired and the palette rendered "No results found": a third instance of the exact
 * defect this card exists to close, byte-for-byte identical to the pre-fix output.
 *
 * Production-reachable, not a lab curiosity: `networkMode` is set nowhere in
 * `packages/web/src`, and the app's only production `QueryClient` (`main.tsx`) sets just
 * `retry` / `refetchOnWindowFocus` / `staleTime`, so production runs the default
 * paused-capable mode. Scope stated honestly: this needs `navigator.onLine === false`, not
 * merely a flaky link. A request that truly *fails* sets `isError` and was already covered.
 *
 * SO THIS FILE USES NO MOCK OF THE HOOK. It drives the real `useQuery` through a real
 * `QueryClient` with `onlineManager` forced offline, which is the only way to produce a
 * genuinely paused query — a fourth boolean on the mock would just be the same
 * by-construction assertion wearing a new name. `queryFn` is a `vi.fn()` that is asserted
 * NEVER TO HAVE RUN, which is what proves the query is paused rather than merely slow.
 *
 * It is deliberately one positive test plus its control, not a second copy of the suite:
 * the loading and error branches are already covered next door. What is uniquely here is
 * the state where both of the old flags are false and `data` is still `undefined`.
 */

const QUERY_FN = vi.fn();

vi.mock('../services/api', () => ({
  applicationService: {
    getAllPaged: (...args: unknown[]) => QUERY_FN(...args),
  },
}));

/** Matches a SUGGESTED_FILTERS title, so the result list is non-empty. */
const MATCHES_A_SUGGESTION = FILTER_SHORTCUT_LABELS.applied;
/** Matches nothing, so the empty state renders. */
const MATCHES_NOTHING = 'Zzzznotathing';

function renderPalette() {
  // `retry: false` keeps a failure from retrying; it does not affect pausing. No
  // `networkMode` override, because the default is the thing under test.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette open onOpenChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { dialog: screen.getByRole('dialog'), client };
}

async function type(query: string) {
  await userEvent.type(screen.getByRole('textbox'), query);
}

beforeEach(() => {
  localStorage.clear();
  QUERY_FN.mockReset();
  QUERY_FN.mockResolvedValue({ applications: [], totalCount: 0, truncated: false });
});

afterEach(() => {
  onlineManager.setOnline(true);
  localStorage.clear();
});

describe('CommandPalette — a PAUSED query is not "No results found" either (WIC-2179)', () => {
  it('PRECONDITION: offline really does produce pending+paused, with isLoading FALSE', async () => {
    // Without this the test below could pass for the wrong reason — e.g. against a query
    // that is merely fetching, which `isLoading` already covered. This pins that the state
    // reached is the one the old predicate missed: `data` undefined while BOTH `isLoading`
    // and `isError` are false.
    onlineManager.setOnline(false);
    const { client } = renderPalette();

    const [query] = client.getQueryCache().getAll();
    const state = query.state;
    expect(state.status).toBe('pending');
    expect(state.fetchStatus).toBe('paused');
    expect(state.data).toBeUndefined();
    // The two flags the first version of the fix read. Both false, right here.
    expect(state.status === 'pending' && state.fetchStatus === 'fetching').toBe(false); // isLoading
    expect(state.status === 'error').toBe(false); // isError
    // Paused, not slow: the fetch never started.
    expect(QUERY_FN).not.toHaveBeenCalled();
  });

  it('does not claim "No results found" while the query is pending but PAUSED', async () => {
    onlineManager.setOnline(false);
    const { dialog } = renderPalette();

    await type(MATCHES_NOTHING);

    expect(dialog).not.toHaveTextContent('No results found');
    expect(dialog).toHaveTextContent('Searching your applications');
    expect(QUERY_FN).not.toHaveBeenCalled();
  });

  it('flags a PARTIAL list while paused, where the empty state never renders', async () => {
    onlineManager.setOnline(false);
    const { dialog } = renderPalette();

    await type(MATCHES_A_SUGGESTION);

    expect(dialog).not.toHaveTextContent('No results found');
    expect(dialog).toHaveTextContent('Still loading your applications');
  });

  it('NEGATIVE CONTROL: online and settled genuinely empty, it DOES say "No results found"', async () => {
    // The other half of the pair. Same real hook, same real client, only `onlineManager`
    // differs — so a fix that simply always renders the notice fails here. This is also
    // what proves the offline assertions above are caused by pausing and not by the
    // service mock returning nothing.
    const { dialog } = renderPalette();
    await screen.findByRole('textbox');

    await type(MATCHES_NOTHING);

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('Searching your applications');
    expect(QUERY_FN).toHaveBeenCalled();
  });
});
