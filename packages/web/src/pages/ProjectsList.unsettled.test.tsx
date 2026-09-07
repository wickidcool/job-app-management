import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsList } from './ProjectsList';

/**
 * WIC-2227 — "you have none" must not be rendered for a request that FAILED or is
 * offline-PAUSED.
 *
 * `ProjectsList` read `const { data: projects = [], isLoading } = useProjects()` and never
 * read `error` at all. `data` is `undefined` in *three* states — pending, paused and
 * failed — so the `= []` default collapsed "don't know yet" and "couldn't find out" into
 * the flat claim the empty state makes: **"Create Your First Project"**.
 *
 * ## Why this file mocks the SERVICE and not the hook
 *
 * The sibling class was already fixed once in `CommandPalette` (WIC-2179), and review
 * round 1 of that card rejected the obvious test shape: a `vi.mock` of the hook whose
 * `data` is derived from the same flags the component branches on makes
 * `data === undefined ⟺ isPending || isError` true *by construction*, so the file asserts
 * the fix's premise instead of testing it. The two states below are precisely the ones
 * such a mock cannot produce.
 *
 * So there is no hook mock here. A real `QueryClient` drives the real `useProjects`, and
 * `projectService` is stubbed one layer lower.
 *
 * ## Why `queryFn` call counts are asserted
 *
 * A paused query and a slow query render identically. The only thing that distinguishes
 * them is that a paused query's `queryFn` **never runs** — so `toHaveBeenCalledTimes(0)`
 * is what proves the state under test is really `fetchStatus: "paused"` and not just an
 * unresolved promise. Likewise `1` in the failure case proves the request really was
 * attempted and really did reject.
 *
 * ## Production reachability
 *
 * `networkMode` is set nowhere in `packages/web/src`, and the app's only production
 * `QueryClient` (`main.tsx`) sets just `retry` / `refetchOnWindowFocus` / `staleTime`, so
 * production runs the default paused-capable `'online'` mode. The failure half needs no
 * offline at all — any 500 does it, and it is permanent, because `isError` leaves `data`
 * undefined forever.
 */

const LIST_PROJECTS = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    projectService: { listProjects: (...args: unknown[]) => LIST_PROJECTS(...args) },
  };
});

/** The copy the empty state renders — the false claim under test. */
const EMPTY_STATE_CALL_TO_ACTION = /Create Your First Project/i;

function aProject(name = 'Quarterly Roadmap') {
  return { id: 'p1', slug: 'quarterly-roadmap', name, fileCount: 2, updatedAt: new Date() };
}

function renderProjectsList() {
  // `retry: false` keeps a rejection from retrying; it does not affect pausing, and no
  // `networkMode` is set because the default is the thing under test.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectsList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  LIST_PROJECTS.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('ProjectsList — an unread project list is not an empty one (WIC-2227)', () => {
  it('CONTROL: a successful response renders the projects and NOT the empty state', async () => {
    // Without this passing, neither assertion below carries information: the matcher has
    // to be able to tell the empty state from a rendered list in the first place.
    LIST_PROJECTS.mockResolvedValue([aProject()]);

    renderProjectsList();

    expect(await screen.findByText('Quarterly Roadmap')).toBeTruthy();
    expect(screen.queryByText(EMPTY_STATE_CALL_TO_ACTION)).toBeNull();
    expect(LIST_PROJECTS).toHaveBeenCalledTimes(1);
  });

  it('a FAILED request discloses the failure instead of claiming the user has no projects', async () => {
    LIST_PROJECTS.mockRejectedValue(new Error('500'));

    renderProjectsList();

    expect(await screen.findByText(/Failed to load projects/i)).toBeTruthy();
    // The harm this card is about, named directly rather than inferred from a diff.
    expect(screen.queryByText(EMPTY_STATE_CALL_TO_ACTION)).toBeNull();
    // The request really was attempted and really did fail.
    expect(LIST_PROJECTS).toHaveBeenCalledTimes(1);
  });

  it('an offline-PAUSED query does not claim the user has no projects', async () => {
    onlineManager.setOnline(false);
    // Deliberately resolvable: the user HAS a project. If this ever renders the empty
    // state, the page is contradicting data the fixture proves exists.
    LIST_PROJECTS.mockResolvedValue([aProject()]);

    renderProjectsList();

    await waitFor(() => {
      expect(screen.queryByText(EMPTY_STATE_CALL_TO_ACTION)).toBeNull();
    });
    // 0 calls is what makes this a PAUSED query rather than a merely slow one.
    expect(LIST_PROJECTS).toHaveBeenCalledTimes(0);
  });
});
