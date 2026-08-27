import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApplicationsList } from '../pages/ApplicationsList';
import { FilterPanel, type FilterOptions } from './FilterPanel';
import type { ApplicationStatus } from '../types/application';

/**
 * WIC-1612 — `/applications` has two writers for one piece of filter state.
 *
 * `ApplicationsList` owns `filters`; both `SavedFilterShortcuts` (`onApplyFilter`) and
 * `FilterPanel` (`onFilterChange`) write to it. `FilterPanel` used to copy the
 * `activeFilters` prop into four `useState`s, whose initialisers run on first mount
 * only — so once the panel was open, every shortcut write was invisible to it. The
 * panel then denied that any filter was active (hiding **Clear All**), disagreed with
 * the shortcuts bar rendered directly above it, and — worst — spread its own stale
 * `[]` on the next toggle, discarding statuses the user never touched.
 *
 * The first describe drives the **real composition**, because that is the only place
 * the defect exists: `FilterPanel` alone never misbehaves, and a hand-built stand-in
 * host would only prove that the component obeys whatever the stand-in passes it.
 * Page state is read back off the request `ApplicationsList` issues, which is observed
 * entirely outside `FilterPanel` — a panel that merely tells itself a consistent story
 * cannot satisfy it.
 *
 * The second describe pins the controlled contract at the component boundary, so a
 * regression to prop-copying `useState` is caught without standing up the page.
 */

const STATUS_CHECKBOX_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Filter by Saved',
  applied: 'Filter by Applied',
  phone_screen: 'Filter by Phone Screen',
  interview: 'Filter by Interview',
  offer: 'Filter by Offer',
  rejected: 'Filter by Rejected',
  withdrawn: 'Filter by Withdrawn',
};

const ALL_STATUSES = Object.keys(STATUS_CHECKBOX_LABELS) as ApplicationStatus[];

/** The statuses the "Interviews This Week" predefined shortcut applies. */
const SHORTCUT_STATUSES: ApplicationStatus[] = ['interview', 'phone_screen'];

function apiRow(id: string, company: string, status: ApplicationStatus) {
  return {
    id,
    jobTitle: `Engineer ${id}`,
    company,
    status,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

const ROWS = [
  apiRow('a', 'Acme', 'interview'),
  apiRow('b', 'Borealis', 'offer'),
  apiRow('c', 'Cyberdyne', 'applied'),
];

/**
 * Records every URL the page asks for. `applicationService.getAll` encodes the page's
 * `filters.status` into `?status=`, so this array is a read of `ApplicationsList`'s own
 * state that does not pass through `FilterPanel`'s render at all.
 */
function stubApplicationsFetch(): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url =
        typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
      requested.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ applications: ROWS, totalCount: ROWS.length }),
      };
    })
  );
  return requested;
}

/** The `status` values carried by the most recent `/applications` request. */
function lastRequestedStatuses(requested: string[]): string[] {
  const last = [...requested].reverse().find((u) => u.includes('/applications'));
  if (last === undefined) throw new Error('the page never requested /applications');
  const query = last.includes('?') ? last.slice(last.indexOf('?') + 1) : '';
  const raw = new URLSearchParams(query).get('status');
  return raw ? raw.split(',') : [];
}

/** Accessible names of every checked checkbox currently rendered. */
function checkedCheckboxNames(): string[] {
  return screen
    .getAllByRole('checkbox')
    .filter((box) => (box as HTMLInputElement).checked)
    .map((box) => box.getAttribute('aria-label') ?? '');
}

function renderApplicationsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/applications']}>
        <ApplicationsList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Opens the collapsible panel, then applies the "Interviews This Week" shortcut. */
async function openPanelThenApplyShortcut(user: ReturnType<typeof userEvent.setup>) {
  // Order matters: the defect only exists when the panel is ALREADY MOUNTED when the
  // shortcut writes. Applying the shortcut first would let the (removed) `useState`
  // initialisers read the fresh value and the bug would not reproduce.
  await user.click(screen.getByRole('button', { name: 'Show filters' }));
  await screen.findByRole('checkbox', { name: STATUS_CHECKBOX_LABELS.interview });
  await user.click(screen.getByRole('button', { name: /Interviews This Week/ }));
}

describe('/applications filter panel, driven by the real page (WIC-1612)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the shortcut’s statuses as checked once the shortcut is applied', async () => {
    const user = userEvent.setup();
    const requested = stubApplicationsFetch();
    renderApplicationsPage();
    await openPanelThenApplyShortcut(user);

    // The page really is filtered...
    await waitFor(() =>
      expect(lastRequestedStatuses(requested).sort()).toEqual([...SHORTCUT_STATUSES].sort())
    );

    // ...and the panel says so. Pre-fix this was `[]` — 0 of the checkboxes checked.
    await waitFor(() =>
      expect(checkedCheckboxNames().sort()).toEqual(
        SHORTCUT_STATUSES.map((s) => STATUS_CHECKBOX_LABELS[s]).sort()
      )
    );
  });

  it('offers Clear All once a shortcut has made filters active', async () => {
    const user = userEvent.setup();
    stubApplicationsFetch();
    renderApplicationsPage();

    expect(screen.queryByRole('button', { name: 'Clear all filters' })).not.toBeInTheDocument();

    await openPanelThenApplyShortcut(user);

    // `hasActiveFilters` gated this row on the stale local copies, so the only control
    // that could undo a shortcut never rendered.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument()
    );
    const chipRow = screen.getByText('Active Filters:').closest('div')?.parentElement;
    expect(chipRow).not.toBeNull();
    expect(within(chipRow as HTMLElement).getByText(/Interview/)).toBeInTheDocument();
  });

  it('does not let the panel and the shortcuts bar disagree about active filters', async () => {
    const user = userEvent.setup();
    stubApplicationsFetch();
    renderApplicationsPage();
    await openPanelThenApplyShortcut(user);

    // `SavedFilterShortcuts` computes the same predicate from the fresh prop, so it
    // showed "+ Save Current" at the exact moment the panel below claimed nothing was
    // active. Both read one source now, so both must agree.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Save Current' })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument();
  });

  it('adds to the shortcut’s statuses when one more is ticked, instead of replacing them', async () => {
    const user = userEvent.setup();
    const requested = stubApplicationsFetch();
    renderApplicationsPage();
    await openPanelThenApplyShortcut(user);

    await waitFor(() => expect(lastRequestedStatuses(requested)).toHaveLength(2));

    await user.click(screen.getByRole('checkbox', { name: STATUS_CHECKBOX_LABELS.offer }));

    // The user harm, stated as the page's own request: one click added `offer` and,
    // pre-fix, dropped `interview` and `phone_screen` — filters they never touched.
    await waitFor(() =>
      expect(lastRequestedStatuses(requested).sort()).toEqual(
        [...SHORTCUT_STATUSES, 'offer'].sort()
      )
    );
    expect(checkedCheckboxNames().sort()).toEqual(
      [...SHORTCUT_STATUSES, 'offer' as ApplicationStatus]
        .map((s) => STATUS_CHECKBOX_LABELS[s])
        .sort()
    );
  });

  it('unticking a status after a shortcut removes only that status', async () => {
    const user = userEvent.setup();
    const requested = stubApplicationsFetch();
    renderApplicationsPage();
    await openPanelThenApplyShortcut(user);

    await waitFor(() => expect(lastRequestedStatuses(requested)).toHaveLength(2));

    await user.click(screen.getByRole('checkbox', { name: STATUS_CHECKBOX_LABELS.phone_screen }));

    await waitFor(() => expect(lastRequestedStatuses(requested)).toEqual(['interview']));
  });

  it('commits search keystrokes to the page at once, but to the API only once typing settles', async () => {
    // The debounce that used to justify `FilterPanel` holding local `searchInput` moved
    // to `ApplicationsList`, between the committed filters and the API. Both halves of
    // that trade need cover: the box must still be responsive, and the network must
    // still be spared a request per character.
    const user = userEvent.setup();
    const requested = stubApplicationsFetch();
    renderApplicationsPage();
    await user.click(screen.getByRole('button', { name: 'Show filters' }));
    const box = await screen.findByRole('textbox', { name: 'Search applications' });

    await user.type(box, 'acme');

    // The panel is controlled, so the box can only ever show what the page state holds.
    // Seeing all four characters is therefore proof they reached `ApplicationsList`.
    expect(box).toHaveValue('acme');

    await waitFor(() => expect(requested.filter((u) => u.includes('search=acme'))).toHaveLength(1));

    // Four keystrokes, but not four searches: undebounced this would request 'a', 'ac',
    // 'acm' and 'acme'.
    const searched = new Set(
      requested
        .map((u) => new URLSearchParams(u.slice(u.indexOf('?') + 1)).get('search'))
        .filter((s): s is string => s !== null)
    );
    expect(searched.size).toBeLessThan(4);
    expect(searched.has('acme')).toBe(true);
  });

  it('removing the search chip clears the search everywhere at once', async () => {
    const user = userEvent.setup();
    const requested = stubApplicationsFetch();
    renderApplicationsPage();
    await user.click(screen.getByRole('button', { name: 'Show filters' }));
    const box = await screen.findByRole('textbox', { name: 'Search applications' });
    await user.type(box, 'acme');

    await waitFor(() => expect(requested.filter((u) => u.includes('search=acme'))).toHaveLength(1));
    // The chip row is gated on `activeFilters`, so it can only appear if the page state
    // really carries the search.
    await user.click(screen.getByRole('button', { name: 'Remove search filter: acme' }));

    expect(box).toHaveValue('');
    await waitFor(() => expect([...requested].reverse()[0]).not.toContain('search='));
  });

  it('Clear All really clears, and the panel follows the page back to empty', async () => {
    const user = userEvent.setup();
    const requested = stubApplicationsFetch();
    renderApplicationsPage();
    await openPanelThenApplyShortcut(user);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));

    await waitFor(() => expect(lastRequestedStatuses(requested)).toEqual([]));
    expect(checkedCheckboxNames()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).not.toBeInTheDocument();
  });

  it('follows a second shortcut applied while the panel is still open', async () => {
    const user = userEvent.setup();
    const requested = stubApplicationsFetch();
    renderApplicationsPage();
    await openPanelThenApplyShortcut(user);

    await waitFor(() => expect(lastRequestedStatuses(requested)).toHaveLength(2));

    // A single resync-on-mount would pass the tests above and still fail here.
    await user.click(screen.getByRole('button', { name: /Active Offers/ }));

    await waitFor(() => expect(lastRequestedStatuses(requested)).toEqual(['offer']));
    expect(checkedCheckboxNames()).toEqual([STATUS_CHECKBOX_LABELS.offer]);
  });
});

describe('FilterPanel is controlled by activeFilters (WIC-1612)', () => {
  const noCompanies: string[] = [];

  function renderPanel(activeFilters: FilterOptions, onFilterChange = vi.fn()) {
    const view = render(
      <FilterPanel
        onFilterChange={onFilterChange}
        activeFilters={activeFilters}
        availableCompanies={noCompanies}
        availableStatuses={ALL_STATUSES}
      />
    );
    const rerenderWith = (next: FilterOptions) =>
      view.rerender(
        <FilterPanel
          onFilterChange={onFilterChange}
          activeFilters={next}
          availableCompanies={noCompanies}
          availableStatuses={ALL_STATUSES}
        />
      );
    return { ...view, rerenderWith, onFilterChange };
  }

  it('re-renders every control when activeFilters changes after mount', async () => {
    const { rerenderWith } = renderPanel({});

    expect(checkedCheckboxNames()).toEqual([]);
    expect(screen.getByRole('switch', { name: 'Active Only' })).toHaveAttribute(
      'aria-checked',
      'false'
    );

    rerenderWith({ status: ['offer', 'rejected'], activeOnly: true });

    await waitFor(() =>
      expect(checkedCheckboxNames().sort()).toEqual(
        [STATUS_CHECKBOX_LABELS.offer, STATUS_CHECKBOX_LABELS.rejected].sort()
      )
    );
    expect(screen.getByRole('switch', { name: 'Active Only' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument();
  });

  it('resyncs the search box when activeFilters.search changes after mount', async () => {
    const { rerenderWith } = renderPanel({});

    expect(screen.getByRole('textbox', { name: 'Search applications' })).toHaveValue('');

    rerenderWith({ search: 'borealis' });

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search applications' })).toHaveValue('borealis')
    );
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument();
  });

  it('reports the filters it was given rather than a copy it keeps itself', async () => {
    // A control that cannot expire: four distinct prop values must produce four
    // distinct checked sets. A panel that snapshots the prop passes the first and
    // fails the rest.
    const { rerenderWith } = renderPanel({});
    const seen: string[] = [];

    for (const status of ['saved', 'applied', 'interview', 'withdrawn'] as ApplicationStatus[]) {
      rerenderWith({ status: [status] });
      await waitFor(() => expect(checkedCheckboxNames()).toHaveLength(1));
      seen.push(checkedCheckboxNames()[0] ?? '');
    }

    expect(new Set(seen).size).toBe(4);
    expect(seen).toEqual(
      ['saved', 'applied', 'interview', 'withdrawn'].map(
        (s) => STATUS_CHECKBOX_LABELS[s as ApplicationStatus]
      )
    );
  });

  it('builds each write from the prop, so an untouched filter survives a toggle', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    renderPanel({ status: ['interview'], company: ['Acme'], activeOnly: true }, onFilterChange);
    onFilterChange.mockClear();

    await user.click(screen.getByRole('checkbox', { name: STATUS_CHECKBOX_LABELS.offer }));

    const written = onFilterChange.mock.calls.at(-1)?.[0] as FilterOptions;
    expect(written.status?.sort()).toEqual(['interview', 'offer']);
    // `company` and `activeOnly` were never touched by this interaction and must come
    // back out untouched.
    expect(written.company).toEqual(['Acme']);
    expect(written.activeOnly).toBe(true);
  });
});
