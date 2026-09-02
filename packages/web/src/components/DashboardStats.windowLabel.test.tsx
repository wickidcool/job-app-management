import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applicationService, dashboardService, resumeService } from '../services/api';
import { Dashboard } from '../pages/Dashboard';
import { APPLIED_WINDOW_DAYS } from '../constants/appliedWindow';
import type { ApplicationStatus } from '../types/application';
import type { DashboardResponse } from '../services/api/types';

/**
 * WIC-1743 — AC-N12 on the two surfaces that render the rolling applied-volume
 * metric.
 *
 * Both are exercised through one render of `Dashboard`, because that is the real
 * composition: `DashboardStats` has exactly one caller in the app
 * (`Dashboard.tsx:45`), and the Recent Activity row is a sibling of the tile row on
 * the same screen. Rendering the page rather than the component also means the tile
 * assertion covers the props Dashboard actually passes, not a hand-built object.
 *
 * The assertions deliberately do NOT compare against
 * `APPLIED_WINDOW_LABEL`/`APPLIED_WINDOW_METRIC_LABEL`. Importing the same constant
 * the component renders makes the test a tautology — it would pass on
 * `label: 'This Week'` the moment someone changed the constant to match. They match
 * on the *shape* the criterion requires instead: the window is named, and no
 * calendar period is.
 */

const BY_STATUS: Record<ApplicationStatus, number> = {
  saved: 2,
  applied: 3,
  phone_screen: 1,
  interview: 3,
  offer: 0,
  rejected: 0,
  withdrawn: 0,
};

/**
 * The fixture is the card's own failure scenario: two applications submitted inside
 * the rolling window, none of them inside the calendar week the old label named. The
 * number 2 is therefore only defensible under a seven-day label.
 *
 * Every figure the Dashboard renders is distinct — total 9, in-review/in-progress 4,
 * response 33, applied-in-window 2 — so the value assertion below cannot pass by
 * matching a neighbouring stat. `appliedThisWeek` and `inReview` were both 2 in the
 * first draft of this fixture, which is exactly the collision that makes a value
 * assertion untrustworthy.
 */
const DASHBOARD_RESPONSE: DashboardResponse = {
  stats: {
    total: 9,
    byStatus: BY_STATUS,
    appliedThisWeek: 2,
    appliedThisMonth: 6,
    // WIC-1514 landed on main after this fixture was written: `responseRate` is a
    // ratio in [0, 1], converted at the render site. 0.33 is the same 33% the
    // comment above counts as this fixture's distinct "response" figure — as a
    // bare 33 it would now render 3300%.
    responseRate: 0.33 as DashboardResponse['stats']['responseRate'],
  },
  recentActivity: [],
  // Required since WIC-1478 added the attention aggregates. Everything is zero
  // and empty: this fixture exists to assert the applied-window tile's *label*,
  // so a populated attention panel would only add unrelated rendering.
  attention: {
    staleThresholdDays: 7,
    savedThresholdDays: 3,
    counts: {
      interviewing: 0,
      stale: 0,
      staleActive: 0,
      missingJobDescription: 0,
      staleSaved: 0,
    },
    samples: {
      interviewing: [],
      staleActive: [],
      missingJobDescription: [],
      staleSaved: [],
    },
  },
};

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('the Dashboard labels its applied-volume metric with the window it measures', () => {
  beforeEach(() => {
    vi.spyOn(dashboardService, 'getStats').mockResolvedValue(DASHBOARD_RESPONSE);
    vi.spyOn(applicationService, 'getAll').mockResolvedValue([]);
    vi.spyOn(resumeService, 'getAll').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('labels the stat tile with the rolling day count', async () => {
    renderDashboard();

    // `DashboardStats.tsx` rendered `This Week` here. A tile label sits beside
    // `Total` / `Response` / `In Review`, so it names the window and not the subject.
    const tileLabel = await screen.findByText(
      new RegExp(`^last ${APPLIED_WINDOW_DAYS} days$`, 'i')
    );

    expect(tileLabel).toBeInTheDocument();
  });

  it('labels the Recent Activity row with both its subject and the rolling day count', async () => {
    renderDashboard();

    // `Dashboard.tsx` rendered `Applied This Week` here. This row has no surrounding
    // card to supply the subject, so the label has to carry it as well as the window.
    const rowLabel = await screen.findByText(
      new RegExp(`applied.*\\b${APPLIED_WINDOW_DAYS}\\b.*days`, 'i')
    );

    expect(rowLabel).toBeInTheDocument();
  });

  it('renders the count the metric actually holds, unchanged by the relabel', async () => {
    renderDashboard();

    // The control on the two label assertions above. AC-N12 is about the label, and a
    // relabel that quietly changed, dropped or duplicated the value would satisfy both
    // of them. `appliedThisWeek: 2` is deliberately distinct from every other number in
    // the fixture, so this cannot pass by matching a neighbouring stat.
    const rowLabel = await screen.findByText(
      new RegExp(`applied.*\\b${APPLIED_WINDOW_DAYS}\\b.*days`, 'i')
    );

    // `waitFor`, not a bare assertion: the labels are static and resolve against
    // Dashboard's zeroed pre-fetch fallback, so a `findByText` on the label says
    // nothing about whether the query has settled. Asserting the value immediately
    // reads `0` — which is how this control earned its place.
    await waitFor(() => {
      expect(rowLabel.parentElement).toHaveTextContent(/\b2\b/);
    });
  });

  it('names no calendar period anywhere on the screen', async () => {
    const { container } = renderDashboard();

    await screen.findByText(new RegExp(`^last ${APPLIED_WINDOW_DAYS} days$`, 'i'));

    // Counted over the whole rendered tree rather than asserted on the two nodes above,
    // because the defect this closes was one label copied to a second surface. A third
    // copy would be invisible to a scoped assertion.
    const calendarPeriodMentions = (container.textContent ?? '').match(/this (week|month)/gi);

    expect(calendarPeriodMentions).toBeNull();
  });
});
