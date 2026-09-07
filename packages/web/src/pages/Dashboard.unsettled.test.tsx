import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dashboard } from './Dashboard';

/**
 * WIC-2227 — the resume widget's "you have none" claim, for a request that failed or is
 * offline-paused.
 *
 * `Dashboard` read `const { data: resumes = [], isLoading: resumesLoading }` and never
 * read `error`. `DashboardResumeWidget` then defaults both counts to `0`, computes
 * `hasResumes = false`, and renders **"No resumes yet"** with **"Upload Your First
 * Resume"** — the same sentence-level false claim as `ProjectsList`, from the same
 * `= []`-over-`undefined` collapse.
 *
 * ## Why this mounts `Dashboard` and not `DashboardResumeWidget`
 *
 * The widget is a pure component: handing it `error` directly would only prove that the
 * branch it just gained renders, which is the least interesting half. What can actually
 * regress is the **wiring** — `Dashboard` reading the flag off the query and passing it
 * down. A component-level test stays green if that prop is never passed, so it would sit
 * one layer away from the defect. These mount the page and stub `resumeService` beneath
 * the real `useResumes`.
 *
 * See `ProjectsList.unsettled.test.tsx` for why the service rather than the hook is
 * mocked, and why the `queryFn` call counts are asserted.
 */

const GET_RESUMES = vi.fn();
const GET_STATS = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resumeService: { getAll: (...a: unknown[]) => GET_RESUMES(...a) },
    dashboardService: { getStats: (...a: unknown[]) => GET_STATS(...a) },
  };
});

/** The claim under test. */
const NO_RESUMES_CLAIM = /No resumes yet/i;
const UPLOAD_FIRST = /Upload Your First Resume/i;

const STATS = {
  stats: {
    total: 0,
    byStatus: {},
    appliedThisWeek: 0,
    appliedThisMonth: 0,
    responseRate: 0,
  },
};

function aResume(name = 'Backend Engineer CV') {
  return { id: 'r1', name, fileName: `${name}.pdf`, createdAt: new Date(), updatedAt: new Date() };
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  GET_RESUMES.mockReset();
  GET_STATS.mockReset();
  GET_STATS.mockResolvedValue(STATS);
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('Dashboard — an unread resume list is not an empty one (WIC-2227)', () => {
  it('CONTROL: when the resumes request settles empty, the widget still says so', async () => {
    // The state the widget is ENTITLED to call empty. Without this, the assertions below
    // would also pass for a widget that had simply lost its empty state.
    GET_RESUMES.mockResolvedValue([]);

    renderDashboard();

    expect(await screen.findByText(NO_RESUMES_CLAIM)).toBeTruthy();
    expect(screen.getByText(UPLOAD_FIRST)).toBeTruthy();
    expect(GET_RESUMES).toHaveBeenCalledTimes(1);
  });

  it('a FAILED resumes request discloses the failure instead of claiming the user has none', async () => {
    GET_RESUMES.mockRejectedValue(new Error('500'));

    renderDashboard();

    expect(await screen.findByText(/Couldn’t load your resumes/i)).toBeTruthy();
    expect(screen.queryByText(NO_RESUMES_CLAIM)).toBeNull();
    expect(screen.queryByText(UPLOAD_FIRST)).toBeNull();
    expect(GET_RESUMES).toHaveBeenCalledTimes(1);
  });

  it('an offline-PAUSED resumes query does not claim the user has no resumes', async () => {
    onlineManager.setOnline(false);
    // The user HAS a resume; rendering the empty state would contradict the fixture.
    GET_RESUMES.mockResolvedValue([aResume()]);

    renderDashboard();

    await waitFor(() => {
      expect(screen.queryByText(NO_RESUMES_CLAIM)).toBeNull();
    });
    expect(screen.queryByText(UPLOAD_FIRST)).toBeNull();
    // 0 calls is what makes this PAUSED rather than slow.
    expect(GET_RESUMES).toHaveBeenCalledTimes(0);
  });
});
