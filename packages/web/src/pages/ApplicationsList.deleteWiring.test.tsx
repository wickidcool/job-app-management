import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApplicationsList } from './ApplicationsList';
import type { APIApplication } from '../services/api/types';

/**
 * The kanban card's Delete button actually deletes (WIC-2079, AC-1 and AC-4).
 *
 * ⚠️ Read this before trusting `ApplicationCard.keyboardNav.test.tsx` as coverage of Delete.
 * That suite renders the component with an `onDelete={vi.fn()}` it supplies ITSELF, so it
 * pins the card's half of the contract and is green whether or not any caller ever passes
 * the prop. In production nobody did: `ApplicationsList` — the sole page mounting
 * `<KanbanBoard>` — passed `onCardClick`, `onEdit`, `onStatusChange` and `loading`, and no
 * `onDelete`. So `handleDelete` ran `confirm('Are you sure…')`, the user confirmed a
 * destructive action, and `onDelete?.(id)` resolved to undefined: no request, no error, no
 * feedback. Confirm-then-silence.
 *
 * That is why this file mounts the PAGE and asserts at the network boundary rather than
 * extending the component suite. The defect lived entirely in the seam between the two, and
 * a mock injected at the seam is precisely the thing that cannot see it. Nothing below
 * `fetch` is stubbed — the real `apiClient`, `applicationService.delete`,
 * `useDeleteApplication`, `KanbanBoard`, `KanbanColumn`, `SortableApplicationCard` and
 * `ApplicationCard` all run.
 *
 * Confirmed as a falsifier before the fix was written (the card asked for exactly this, since
 * "the symptom is confirm-then-silence" was its one unmeasured prediction): against `main` at
 * `9cdccb0a` the first test below fails on `expect(deleteRequests).toHaveLength(1)` with
 * `[]` — the click and the confirm both happen and no DELETE is issued. The premise held.
 */

const ROW: APIApplication = {
  id: 'app-001',
  jobTitle: 'Staff Engineer',
  company: 'Northwind',
  status: 'applied',
  version: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

type Recorded = { method: string; path: string };

/**
 * A one-row server. Returns every request it saw so the assertion can be made about the
 * DELETE actually reaching the network, which is the only place the missing wiring shows up.
 */
function installFetchStub(deleteStatus = 204) {
  const requests: Recorded[] = [];

  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push({ method, path: url.pathname });

    if (method === 'DELETE') {
      return new Response(null, { status: deleteStatus });
    }

    if (url.pathname.endsWith('/applications')) {
      return new Response(JSON.stringify({ applications: [ROW], totalCount: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', stub);
  return requests;
}

/** Rendered by the detail route, so "did we navigate?" is observable rather than assumed. */
const DETAIL_MARKER = 'application-detail-route';

/**
 * A real `<Routes>` tree, not a bare `<MemoryRouter>`.
 *
 * Worth stating because the first draft of this file got it wrong and the mistake is silent:
 * with the page mounted directly under `MemoryRouter`, `navigate()` updates the location and
 * nothing unmounts, so an assertion of the form "the board is gone" passes or fails for
 * reasons unrelated to navigation. A route that actually renders something is the only way
 * for a navigation assertion here to mean anything.
 */
function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/applications']}>
        <Routes>
          <Route path="/applications" element={<ApplicationsList />} />
          <Route path="/applications/:id" element={<div>{DETAIL_MARKER}</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const navigated = () => screen.queryByText(DETAIL_MARKER) !== null;

/** The card is a tab stop; focusing it is what reveals the quick-action bar (WIC-2078). */
async function revealQuickActions(user: ReturnType<typeof userEvent.setup>) {
  const card = await screen.findByRole('article', {
    name: `${ROW.jobTitle} at ${ROW.company}, status: ${ROW.status}`,
  });
  card.focus();
  await waitFor(() => expect(screen.getByRole('button', { name: `Delete ${ROW.jobTitle}` })));
  return { card, user };
}

const deleteButton = () => screen.getByRole('button', { name: `Delete ${ROW.jobTitle}` });

function deletesFor(requests: Recorded[]) {
  return requests.filter((r) => r.method === 'DELETE');
}

describe('ApplicationsList wires the kanban card Delete to a real mutation (WIC-2079)', () => {
  beforeEach(() => {
    localStorage.setItem('auth_token', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('issues a DELETE for the confirmed application', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requests = installFetchStub();
    renderPage();

    await revealQuickActions(user);
    await user.click(deleteButton());

    expect(confirmSpy).toHaveBeenCalledOnce();
    await waitFor(() => expect(deletesFor(requests)).toHaveLength(1));
    expect(deletesFor(requests)[0].path).toMatch(/\/applications\/app-001$/);
  });

  // The confirm is the user's last chance to back out, so a cancelled confirm reaching the
  // network would be strictly worse than the bug this card fixes. Pinned separately because
  // the guard lives in the CARD and the mutation lives in the PAGE: no single-component test
  // can observe that declining stops the request.
  it('issues nothing when the user declines the confirm', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requests = installFetchStub();
    renderPage();

    await revealQuickActions(user);
    await user.click(deleteButton());

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(deletesFor(requests)).toHaveLength(0);
  });

  // AC-4 third bullet, the half that is observable end-to-end. `handleDelete` calls
  // `e.stopPropagation()` so that using the button does not ALSO fire the card's own `onClick`
  // → `navigate('/applications/:id')`. Without it, confirming a delete would navigate away
  // from the board at the same moment the mutation fires — the user would land on the detail
  // page of the row they just deleted.
  //
  // The existing component suite pins the KEYDOWN half of this (WIC-2078's
  // `e.target !== e.currentTarget` guard). The mouse-click half was unpinned, and it is the
  // part most likely to regress while restructuring.
  //
  // Note this pin only exists for DELETE. Edit's `stopPropagation` is genuinely unobservable
  // from here, because `onEdit` and `onCardClick` share a destination (see the AC-3 note in
  // `ApplicationsList.tsx`) — a leaked propagation navigates to the same route twice and looks
  // identical. It is pinned with separable spies in `ApplicationCard.keyboardNav.test.tsx`
  // instead, which is the level at which the two handlers can be told apart.
  it('does not navigate to the application when Delete is clicked (stopPropagation)', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requests = installFetchStub();
    renderPage();

    await revealQuickActions(user);
    await user.click(deleteButton());

    await waitFor(() => expect(deletesFor(requests)).toHaveLength(1));
    expect(navigated()).toBe(false);
  });

  // A failed delete must say so. Silence on error is the same class of defect as the one this
  // card fixes — the house precedent (`ResumeVariantsList`) alerts, and this follows it.
  it('alerts when the delete fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installFetchStub(500);
    renderPage();

    await revealQuickActions(user);
    await user.click(deleteButton());

    await waitFor(() => expect(alertSpy).toHaveBeenCalledOnce());
  });
});
