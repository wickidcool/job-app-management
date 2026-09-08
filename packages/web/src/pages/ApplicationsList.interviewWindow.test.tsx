import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApplicationsList } from './ApplicationsList';
import { INTERVIEWS_THIS_WEEK_PATH, INTERVIEW_WINDOW_PARAM } from '../constants/filterShortcuts';

/**
 * WIC-2194 — the palette's link must arrive at the API as a real window.
 *
 * `SAVED_FILTER_SHORTCUT_NAMING.md` records why this needs its own test: the palette
 * *navigates* rather than emitting `FilterOptions`, so its half of the shortcut travels
 * through the URL and is resolved by this page. WIC-1775's whole finding was that the two
 * surfaces can look identical and behave differently, and the `?status=` half was inert
 * for months without anyone noticing. The window half can go inert the same way.
 *
 * These assert the filter handed to the data layer, not the rendered rows — the rows would
 * be identical whether the window were applied server-side or dropped on the floor, since
 * the fixture is empty either way. Asserting what `useApplicationCollection` receives is
 * the only thing that distinguishes a wired filter from an ignored one.
 */

interface ApiFilters {
  status?: string[];
  search?: string;
  company?: string;
  interviewDateFrom?: string;
  interviewDateTo?: string;
}

const useApplicationCollection = vi.fn((filters?: ApiFilters) => {
  void filters;
  return {
    data: { applications: [], totalCount: 0, truncated: false },
    isPending: false,
    isError: false,
  };
});

vi.mock('../hooks/useApplications', () => ({
  useApplicationCollection: (filters?: ApiFilters) => useApplicationCollection(filters),
  useUpdateApplicationStatus: () => ({ mutate: vi.fn() }),
  useDeleteApplication: () => ({ mutate: vi.fn() }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ApplicationsList />
    </MemoryRouter>
  );
}

function lastFilters(): ApiFilters {
  const calls = useApplicationCollection.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]?.[0] ?? {}) as ApiFilters;
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/;

describe('ApplicationsList — interview-date window from the URL', () => {
  beforeEach(() => {
    useApplicationCollection.mockClear();
  });

  it('resolves the palette link into both API bounds', () => {
    renderAt(INTERVIEWS_THIS_WEEK_PATH);

    const filters = lastFilters();
    expect(filters.interviewDateFrom).toMatch(ISO_WITH_OFFSET);
    expect(filters.interviewDateTo).toMatch(ISO_WITH_OFFSET);
    expect(filters.status).toEqual(['interview', 'phone_screen']);
  });

  it('resolves to the CURRENT week, not a value baked into the link', () => {
    // The marker is semantic precisely so this holds. If the palette ever carried literal
    // instants, this assertion is what would notice — the link is a module-level constant,
    // so a baked window would be correct only during the week it was written.
    const now = Date.now();
    renderAt(INTERVIEWS_THIS_WEEK_PATH);

    const { interviewDateFrom, interviewDateTo } = lastFilters();
    expect(new Date(interviewDateFrom!).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(interviewDateTo!).getTime()).toBeGreaterThanOrEqual(now);
  });

  /**
   * The negative control. Without it, every assertion above is satisfiable by a page that
   * unconditionally applies a week to everything — which would be the *hidden filter*
   * defect (a silently narrowed list under a label that names no window), and would look
   * green here.
   */
  it('applies no window when the marker is absent', () => {
    renderAt('/applications?status=applied');

    const filters = lastFilters();
    expect(filters.interviewDateFrom).toBeUndefined();
    expect(filters.interviewDateTo).toBeUndefined();
    expect(filters.status).toEqual(['applied']);
  });

  it('applies no window for an unrecognised marker value', () => {
    // Matches how `parseStatusParam` drops unknown status tokens: a hand-typed
    // `?interviewWindow=nonsense` filters nothing rather than inventing a window.
    renderAt(`/applications?status=interview&${INTERVIEW_WINDOW_PARAM}=nonsense`);

    expect(lastFilters().interviewDateFrom).toBeUndefined();
  });

  it('drops the window when navigating to a shortcut that does not carry one', async () => {
    // The re-apply path, which is the one WIC-1775 found inert. Navigating away from the
    // interviews shortcut *while the page stays mounted* must clear the window —
    // otherwise `Applied` renders last week's interview window under its own label, which
    // is the same defect one navigation later.
    //
    // This has to be a real in-router navigation, driven by a `Link`. Re-rendering a
    // second `<MemoryRouter initialEntries={…}>` does NOT work: `initialEntries` is read
    // once at mount, so React reconciles the same router instance and the location never
    // changes — the assertion then passes or fails for reasons unrelated to the page. The
    // whole point of this case is that the component is *not* remounted, which is exactly
    // what the state initialiser cannot handle on its own.
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={[INTERVIEWS_THIS_WEEK_PATH]}>
        <Link to="/applications?status=applied">Applied</Link>
        <ApplicationsList />
      </MemoryRouter>
    );

    expect(lastFilters().interviewDateFrom).toMatch(ISO_WITH_OFFSET);

    await user.click(screen.getByRole('link', { name: 'Applied' }));

    expect(lastFilters().interviewDateFrom).toBeUndefined();
    expect(lastFilters().status).toEqual(['applied']);
  });
});
