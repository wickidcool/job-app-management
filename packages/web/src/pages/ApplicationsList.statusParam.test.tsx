import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApplicationsList } from './ApplicationsList';

/**
 * Regression cover for WIC-1775.
 *
 * The command palette links to `/applications?status=interview,phone_screen`, but
 * `ApplicationsList` never read the query string — it imported `useNavigate` only, and
 * seeded `useState<FilterOptions>({})`. So all three of the palette's `?status=` shortcuts
 * landed on the *unfiltered* list, showing every application including `rejected` and
 * `withdrawn`.
 *
 * That is why relabelling alone could not fix the palette entry: renaming
 * `Interviews This Week` to `Interviewing` while the destination still ignored the filter
 * would have swapped one false label for another. The label and the wiring had to land
 * together.
 *
 * These assert the filter handed to the data layer rather than the rendered rows, so the
 * test pins the actual contract (`useApplicationCollection` receives the statuses) and
 * does not depend on fixture data flowing through Kanban rendering.
 */

interface ApiFilters {
  status?: string[];
  search?: string;
  company?: string;
}

const useApplicationCollection = vi.fn((filters?: ApiFilters) => {
  void filters;
  return { data: { applications: [], totalCount: 0, truncated: false }, isLoading: false };
});

vi.mock('../hooks/useApplications', () => ({
  useApplicationCollection: (filters?: ApiFilters) => useApplicationCollection(filters),
  useUpdateApplicationStatus: () => ({ mutate: vi.fn() }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ApplicationsList />
    </MemoryRouter>
  );
}

function lastStatusFilter(): string[] | undefined {
  const calls = useApplicationCollection.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0]?.status;
}

describe('ApplicationsList — ?status= query parameter', () => {
  beforeEach(() => {
    useApplicationCollection.mockClear();
  });

  it('applies the multi-status filter the command palette links with', () => {
    renderAt('/applications?status=interview,phone_screen');

    expect(lastStatusFilter()).toEqual(['interview', 'phone_screen']);
  });

  it('applies a single-status filter', () => {
    renderAt('/applications?status=offer');

    expect(lastStatusFilter()).toEqual(['offer']);
  });

  it('applies no status filter when the parameter is absent', () => {
    renderAt('/applications');

    expect(lastStatusFilter()).toBeUndefined();
  });

  it('ignores an unrecognised status rather than forwarding it to the API', () => {
    renderAt('/applications?status=not_a_status');

    expect(lastStatusFilter()).toBeUndefined();
  });
});
