import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApplicationsList } from '../pages/ApplicationsList';
import { FilterPanel, type FilterOptions } from './FilterPanel';
import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';
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

/** The statuses the `interviewing` predefined shortcut applies. */
const SHORTCUT_STATUSES: ApplicationStatus[] = ['interview', 'phone_screen'];

function apiRow(
  id: string,
  company: string,
  status: ApplicationStatus,
  dates: { createdAt?: string; appliedAt?: string } = {}
) {
  return {
    id,
    jobTitle: `Engineer ${id}`,
    company,
    status,
    version: 1,
    // Spelled out per row rather than derived from `id` or from each other: a fixture
    // field computed from another cannot demonstrate that the two are read separately,
    // which is the whole question `appliedAt`-over-`createdAt` turns on.
    createdAt: dates.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...(dates.appliedAt === undefined ? {} : { appliedAt: dates.appliedAt }),
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
function stubApplicationsFetch(rows: ReturnType<typeof apiRow>[] = ROWS): string[] {
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
        json: async () => ({ applications: rows, totalCount: rows.length }),
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

/**
 * Opens the collapsible panel, then applies the `interviewing` shortcut.
 *
 * The label is read from `FILTER_SHORTCUT_LABELS`, not spelled out: WIC-1775 renamed this
 * shortcut from `Interviews This Week` to `Interviewing` (the old name promised a time
 * window the status-only filter never applied), and a hardcoded copy here would silently
 * stop matching — which is exactly how this merge first broke.
 */
async function openPanelThenApplyShortcut(user: ReturnType<typeof userEvent.setup>) {
  // Order matters: the defect only exists when the panel is ALREADY MOUNTED when the
  // shortcut writes. Applying the shortcut first would let the (removed) `useState`
  // initialisers read the fresh value and the bug would not reproduce.
  await user.click(screen.getByRole('button', { name: 'Show filters' }));
  await screen.findByRole('checkbox', { name: STATUS_CHECKBOX_LABELS.interview });
  await user.click(screen.getByRole('button', { name: FILTER_SHORTCUT_LABELS.interviewing }));
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

/**
 * WIC-1613 — US-6.3's "Filter by status, company, **date**".
 *
 * `FilterOptions.dateRange` existed as a declaration and nothing else: no control wrote
 * it, no list read it. That is invisible to any scan that greps for the requirement's
 * vocabulary, because the vocabulary was all there — so these tests are deliberately
 * built around **producer and consumer**, not around the presence of a field or a
 * control. Every assertion below is on which rows the page actually renders, which no
 * amount of type declaration can satisfy.
 *
 * `Date` fixtures land at midday UTC so that the row's local calendar day is the same
 * one everywhere between UTC-12 and UTC+12; the bounds are days apart from the rows, so
 * no assertion here turns on the runner's `TZ`. Local-day boundary behaviour is pinned
 * separately, and TZ-safely, in `utils/dateRangeFilter.test.ts`.
 */
describe('/applications filters by date, end to end (WIC-1613)', () => {
  /**
   * Three rows, each chosen for one job:
   *  - `march` is inside the window under test;
   *  - `june` is outside it, so an unwired filter (which removes nothing) fails;
   *  - `saved` has NO `appliedAt` at all — the `saved` status never has one — and its
   *    `createdAt` is inside the window. It is what proves the `createdAt` fallback is
   *    live: filtering on `appliedAt` alone would drop it.
   */
  const DATED_ROWS = [
    apiRow('march', 'Acme', 'applied', {
      createdAt: '2026-02-01T12:00:00.000Z',
      appliedAt: '2026-03-10T12:00:00.000Z',
    }),
    apiRow('june', 'Borealis', 'applied', {
      createdAt: '2026-06-01T12:00:00.000Z',
      appliedAt: '2026-06-05T12:00:00.000Z',
    }),
    apiRow('saved', 'Cyberdyne', 'saved', { createdAt: '2026-03-20T12:00:00.000Z' }),
  ];

  const MARCH = { from: '2026-03-01', to: '2026-03-31' };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Job titles of the application cards the board is currently rendering. */
  function renderedRoleIds(): string[] {
    return screen
      .queryAllByRole('heading', { level: 3 })
      .map((h) => h.textContent ?? '')
      .filter((t) => t.startsWith('Engineer '))
      .map((t) => t.replace('Engineer ', ''))
      .sort();
  }

  async function openPanelWithDatedRows() {
    const user = userEvent.setup();
    stubApplicationsFetch(DATED_ROWS);
    renderApplicationsPage();
    await user.click(screen.getByRole('button', { name: 'Show filters' }));
    await screen.findByLabelText('Filter from date');
    // The control cannot be credited with removing a row it never had. Pin the
    // unfiltered set first, or "the June row is absent" is satisfied by a page that
    // renders nothing at all.
    await waitFor(() => expect(renderedRoleIds()).toEqual(['june', 'march', 'saved']));
    return user;
  }

  /** `<input type="date">` does not accept per-character typing in jsdom. */
  function pickDate(label: string, day: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: day } });
  }

  it('renders a date control at all, labelled with WHICH date it filters on', async () => {
    await openPanelWithDatedRows();

    // US-6.3 does not say which of the three dates on `Application` it means, so the
    // panel has to. A control labelled only "Date" would leave the user inferring the
    // rule from which rows vanish.
    expect(screen.getByText('Date added / applied')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter from date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Filter to date')).toHaveAttribute('type', 'date');
  });

  it('drops the rows outside the window and keeps the ones inside', async () => {
    await openPanelWithDatedRows();

    pickDate('Filter from date', MARCH.from);
    pickDate('Filter to date', MARCH.to);

    // The June row goes, and — the fallback, which a naive `appliedAt`-only filter
    // fails — the saved row with no `appliedAt` stays on its `createdAt`.
    await waitFor(() => expect(renderedRoleIds()).toEqual(['march', 'saved']));
  });

  it('filters on appliedAt in preference to createdAt', async () => {
    // `march` was created 1 February and applied 10 March. A February window must not
    // find it and a March window must — the same row, the same fixture, opposite
    // verdicts, which only a filter reading `appliedAt` can produce.
    await openPanelWithDatedRows();

    pickDate('Filter from date', '2026-02-01');
    pickDate('Filter to date', '2026-02-28');
    await waitFor(() => expect(renderedRoleIds()).toEqual([]));

    pickDate('Filter from date', MARCH.from);
    pickDate('Filter to date', MARCH.to);
    await waitFor(() => expect(renderedRoleIds()).toEqual(['march', 'saved']));
  });

  it('applies a one-sided window, which the old {start; end} type could not express', async () => {
    await openPanelWithDatedRows();

    pickDate('Filter from date', '2026-04-01');

    await waitFor(() => expect(renderedRoleIds()).toEqual(['june']));
    expect(screen.getByLabelText('Filter to date')).toHaveValue('');
  });

  it('offers the presets COMPONENT_SPECS §6 names, and they write the same two boxes', async () => {
    const user = await openPanelWithDatedRows();

    await user.click(screen.getByRole('button', { name: 'This Month' }));

    // The presets are shorthand for the inputs, not a parallel filter: after clicking
    // one, both boxes must show the window it chose and stay editable.
    await waitFor(() => expect(screen.getByLabelText('Filter from date')).not.toHaveValue(''));
    expect(screen.getByLabelText('Filter to date')).not.toHaveValue('');
    for (const label of ['This Week', 'Last 3 Months']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the window as a removable chip that really restores the full list', async () => {
    const user = await openPanelWithDatedRows();

    pickDate('Filter from date', MARCH.from);
    pickDate('Filter to date', MARCH.to);
    await waitFor(() => expect(renderedRoleIds()).toEqual(['march', 'saved']));

    // The chip row is gated on `activeFilters`, so its appearance is itself a read of
    // page state rather than of anything the panel remembers.
    expect(
      screen.getByText(`Date added / applied: ${MARCH.from} → ${MARCH.to}`)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove date filter' }));

    await waitFor(() => expect(renderedRoleIds()).toEqual(['june', 'march', 'saved']));
    expect(screen.getByLabelText('Filter from date')).toHaveValue('');
  });

  it('Clear All clears the date window along with everything else', async () => {
    const user = await openPanelWithDatedRows();

    pickDate('Filter from date', MARCH.from);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));

    await waitFor(() => expect(renderedRoleIds()).toEqual(['june', 'march', 'saved']));
    expect(screen.getByLabelText('Filter from date')).toHaveValue('');
  });

  it('survives being saved as a shortcut and re-applied from localStorage', async () => {
    // This is the test that decided the bound type. `SavedFilterShortcuts` persists
    // whole `FilterOptions` objects through `JSON.stringify`/`JSON.parse`. With the old
    // `{ start: Date; end: Date }` the range would come back as strings still TYPED as
    // `Date` — typechecking cleanly and then behaving as no filter at all, or throwing
    // at the first `.getTime()`. Storing the calendar day makes the persisted and the
    // live shapes the same object.
    const user = await openPanelWithDatedRows();

    pickDate('Filter from date', MARCH.from);
    pickDate('Filter to date', MARCH.to);
    await waitFor(() => expect(renderedRoleIds()).toEqual(['march', 'saved']));

    // "+ Save Current" is gated by `SavedFilterShortcuts`' own predicate, which did not
    // know about `dateRange` — so its appearing here is also the fix for the two bars
    // disagreeing about whether a date window counts as an active filter.
    await user.click(screen.getByRole('button', { name: '+ Save Current' }));
    await user.type(screen.getByLabelText('Save current filters as:'), 'March intake');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    await waitFor(() => expect(renderedRoleIds()).toEqual(['june', 'march', 'saved']));

    // Round-trips through `localStorage`, not just through React state.
    expect(localStorage.getItem('wic-saved-filters')).toContain(MARCH.from);

    // Exact, not a regex: the shortcut's own delete button is named "Delete March
    // intake filter" and a loose match finds both.
    await user.click(screen.getByRole('button', { name: 'March intake' }));

    await waitFor(() => expect(renderedRoleIds()).toEqual(['march', 'saved']));
    expect(screen.getByLabelText('Filter from date')).toHaveValue(MARCH.from);
  });
});
