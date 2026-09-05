/* eslint-disable react-refresh/only-export-components --
   Same rationale as `routeOutlineHarness.tsx`: this is a test harness, not a component
   module. It is `.tsx` only because the provider and route stack it mounts is JSX, and it
   exports no component at all — both exports are helpers the four `Reports*` keyboard-nav
   tests call. Fast refresh never sees this file, so the rule has nothing to protect here.
   Scoped to this file rather than added as a test-glob override in eslint.config.js,
   matching the existing precedent. */

import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { render } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Shared harness for the four `Reports*` keyboard-navigation tests (WIC-2062).
 *
 * Each of those pages rendered its application card as a bare `<div onClick={…}>`, so the
 * card was reachable by mouse only — a WCAG 2.1.1 failure that `jsx-a11y` recorded as
 * `click-events-have-key-events` + `no-static-element-interactions`. Navigation now hangs
 * off a real `<button>` inside each card's heading. These helpers exist so all four pages
 * are pinned the same way rather than four slightly different ways.
 *
 * The router is real, not a `useNavigate` mock: the assertion that matters is where the
 * user *lands*, and a mock would keep passing if the destination path were wrong.
 */

/**
 * Stands in for `ApplicationDetail`, echoing the id so the route param is pinned too.
 *
 * The "Go back" control is what makes a *duplicate* navigation observable, and it is the
 * only thing that does — see `LocationRecorder` below for why the obvious approach fails.
 * One `navigate(-1)` returns to the report if the app pushed one history entry, and stays
 * on this page if it pushed two.
 */
function LandedApplication() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <>
      <h1>Application {id}</h1>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
    </>
  );
}

/**
 * Records each location the router settles on, so a test can assert where a click led.
 *
 * ⚠️ **This cannot count duplicate navigations, and must not be used to try.** Two
 * `navigate()` calls to the same URL from one click land in the same React batch, so the
 * component re-renders once, this effect runs once, and the recorder sees a single entry
 * — identical to the correct single-navigation case. Measured against a mutant that
 * restores the card wrapper's `onClick`: the recorder-based assertion stayed green while
 * the page really did push two history entries.
 *
 * A duplicate is only observable through the history *stack*, which is why
 * `LandedApplication` carries a "Go back" button. Use that; see the double-navigate test
 * in `ReportsStale.keyboardNav.test.tsx`.
 */
function LocationRecorder({ visited }: { visited: string[] }) {
  const location = useLocation();
  useEffect(() => {
    visited.push(location.pathname);
  }, [location, visited]);
  return null;
}

/**
 * Render one report page under a router that also has an `/applications/:id` route.
 *
 * `visited` is the live list of pathnames the router has settled on, starting with
 * `path` itself. Read it after an interaction to assert both the destination and how
 * many times the app navigated to get there.
 */
export function renderReportPage(page: ReactElement, path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const visited: string[] = [];

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationRecorder visited={visited} />
        <Routes>
          <Route path={path} element={page} />
          <Route path="/applications/:id" element={<LandedApplication />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { ...result, visited };
}

/**
 * Tab forward until `target` holds focus, and report how many presses it took.
 *
 * Deliberately a search rather than a fixed number of `user.tab()` calls: the count
 * depends on how much chrome each page renders ahead of the card, which is not what
 * these tests are about, and hard-coding it would make them fail on an unrelated
 * filter control being added. `-1` means the element was never reached — which is
 * exactly the state the four pages were in before this change, since a `<div>` with
 * no `tabIndex` is not in the tab order at all.
 */
export async function tabUntilFocused(
  user: UserEvent,
  target: HTMLElement,
  maxPresses = 25
): Promise<number> {
  for (let presses = 1; presses <= maxPresses; presses += 1) {
    await user.tab();
    if (document.activeElement === target) return presses;
  }
  return -1;
}
