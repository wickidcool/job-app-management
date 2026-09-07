import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';
import { Breadcrumb } from '../components/Breadcrumb';
import { KanbanBoard } from '../components/KanbanBoard';
import { FilterPanel, type FilterOptions } from '../components/FilterPanel';
import { SavedFilterShortcuts } from '../components/SavedFilterShortcuts';
import { FloatingActionButton } from '../components/FloatingActionButton';
import {
  useApplicationCollection,
  useDeleteApplication,
  useUpdateApplicationStatus,
} from '../hooks/useApplications';
import { useDebounce } from '../hooks/useDebounce';
import { filterByDateRange } from '../utils/dateRangeFilter';
import { parseStatusParam } from '../constants/applicationStatus';
import { INTERVIEW_WINDOW_PARAM, INTERVIEW_WINDOW_THIS_WEEK } from '../constants/filterShortcuts';
import { interviewWeekWindow } from '../utils/interviewWeek';
import type { Application, ApplicationStatus } from '../types/application';
import { DEFAULT_STALE_THRESHOLD_DAYS, isStale } from '../constants/stale';

const ACTIVE_STATUSES: ApplicationStatus[] = ['saved', 'applied', 'phone_screen', 'interview'];

function calculatePipelineStats(applications: Application[]) {
  const today = startOfDay(new Date());
  const activeApps = applications.filter((app) => ACTIVE_STATUSES.includes(app.status));

  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;
  let stale = 0;

  for (const app of activeApps) {
    if (app.nextActionDue) {
      const dueDate = startOfDay(parseISO(app.nextActionDue));
      const daysUntilDue = differenceInDays(dueDate, today);
      if (daysUntilDue < 0) overdue++;
      else if (daysUntilDue === 0) dueToday++;
      else if (daysUntilDue <= 3) dueSoon++;
    }

    // WIC-1479: this counted every *active* status at 14 days, so `saved` and
    // `interview` rows landed in a tile whose neighbours all lead to the same
    // follow-up workflow the report drives. One definition, one count.
    if (isStale(app)) stale++;
  }

  return { active: activeApps.length, overdue, dueToday, dueSoon, stale };
}

/**
 * One pipeline-summary tile.
 *
 * Extracted from five inlined copies (WIC-2229) so the `unsettled` gate is written once.
 * The tiles were the only part of this page with NO loading gate — `KanbanBoard` took
 * `loading` and skeletoned, while these rendered `calculatePipelineStats([])` — so a slow
 * request stated "Active 0 / Overdue 0 / …" for as long as it took to arrive. Five inline
 * ternaries would have made that one careless edit away from returning.
 */
function PipelineStat({
  value,
  label,
  valueClassName,
  unsettled,
}: {
  value: number;
  label: string;
  valueClassName: string;
  unsettled: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      {unsettled ? (
        <div
          className="mb-1 h-8 w-10 animate-pulse rounded bg-neutral-200"
          role="status"
          aria-label={`Loading ${label} count`}
        />
      ) : (
        <div className={`text-2xl font-bold ${valueClassName}`}>{value}</div>
      )}
      <div className="text-sm text-neutral-600">{label}</div>
    </div>
  );
}

export function ApplicationsList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const interviewWindowParam = searchParams.get(INTERVIEW_WINDOW_PARAM);

  // The command palette links here as
  // `/applications?status=interview,phone_screen&interviewWindow=this-week`. Until
  // WIC-1775 that query string was never read, so every shortcut landed on the unfiltered
  // list and the label above it was false whatever it said.
  //
  // WIC-2194 adds the window half. It arrives as the *marker* `this-week` rather than as
  // resolved instants, and is resolved here, on arrival — so a bookmarked or shared link
  // means "this week" whenever it is followed, not the week it was created in. An
  // unrecognised value yields no window at all, matching how `parseStatusParam` drops
  // unknown status tokens rather than forwarding them.
  const windowFromParam = (value: string | null) =>
    value === INTERVIEW_WINDOW_THIS_WEEK ? interviewWeekWindow() : undefined;

  const [filters, setFilters] = useState<FilterOptions>(() => {
    const status = parseStatusParam(statusParam);
    const interviewDateRange = windowFromParam(interviewWindowParam);
    return {
      ...(status.length > 0 ? { status } : {}),
      ...(interviewDateRange ? { interviewDateRange } : {}),
    };
  });
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [prevStatusParam, setPrevStatusParam] = useState(statusParam);
  const [prevInterviewWindowParam, setPrevInterviewWindowParam] = useState(interviewWindowParam);

  // Re-apply when a shortcut navigates here while this page is already mounted — the
  // initialiser above only runs on first render. This is the derived-state-during-render
  // pattern (as in CommandPalette), not an effect: an effect would render the stale list
  // first and then correct it, and the lint rule rejects the cascading render.
  if (statusParam !== prevStatusParam) {
    setPrevStatusParam(statusParam);
    const status = parseStatusParam(statusParam);
    if (status.length > 0) {
      setFilters((prev) => ({ ...prev, status }));
    }
  }

  // Tracked separately from `statusParam`, not folded into it: navigating from
  // `Interviews This Week` to `Applied` changes both params, but navigating *away* from
  // the interviews shortcut drops this one alone. Keying only on `statusParam` would
  // leave last week's window applied under the new shortcut's label — the same defect,
  // one navigation later.
  if (interviewWindowParam !== prevInterviewWindowParam) {
    setPrevInterviewWindowParam(interviewWindowParam);
    setFilters((prev) => {
      const interviewDateRange = windowFromParam(interviewWindowParam);
      if (interviewDateRange) return { ...prev, interviewDateRange };
      // `delete` on a copy rather than a rest-destructure: the lint config rejects the
      // unused binding that `const { interviewDateRange: _x, ...rest }` leaves behind.
      const next = { ...prev };
      delete next.interviewDateRange;
      return next;
    });
  }

  // `filters` updates on every keystroke so that `FilterPanel` can stay controlled (it
  // holds no state of its own — see WIC-1612), so the debounce that used to live inside
  // the panel lives here instead: between the committed filter state and the API, which
  // is the only place that actually needed protecting from a request per character.
  const debouncedSearch = useDebounce(filters.search, 300);

  // Convert FilterOptions to API filter format
  const apiFilters = useMemo(
    () => ({
      status: filters.status,
      search: debouncedSearch,
      // API only supports single company partial match, not multiple exact matches
      // We'll handle multiple companies via client-side filtering
      company: undefined,
      // WIC-2194 — server-side, unlike `company`/`activeOnly`/`dateRange` below. The
      // capability shipped in WIC-2189 and had no client caller, so filtering here
      // instead would have left that validated path dark while duplicating its predicate,
      // and would only have been correct up to `getAllPaged`'s 5,000-row budget. These
      // bounds are already offset-bearing instants; `interviewWeekWindow` is the only
      // thing that should ever construct them.
      interviewDateFrom: filters.interviewDateRange?.from,
      interviewDateTo: filters.interviewDateRange?.to,
    }),
    [filters.status, debouncedSearch, filters.interviewDateRange]
  );

  // ⚠️ `isPending` + `isError`, NOT `isLoading` (WIC-2227/WIC-2229). `isLoading` is
  // `isPending && isFetching`, so it is false for a pending-but-*paused* query, and it is
  // false for a failed one — `data` is undefined in all three states. This page had no
  // `isError` read at all, so a failed `getAllPaged` rendered the whole account as empty:
  // five zeroed pipeline tiles and six "No <status> applications" board columns, with
  // `isPartialView` correctly suppressed, which made it read as an authoritative complete
  // view of nothing.
  const { data: collection, isPending, isError } = useApplicationCollection(apiFilters);
  // Memoised so the `?? []` fallback does not hand a fresh array to the
  // downstream useMemo deps on every render.
  const rawApplications = useMemo(() => collection?.applications ?? [], [collection]);
  // The service pages `GET /api/applications` to exhaustion; `truncated` is only
  // set if it ran out of page budget first. Say so rather than presenting a
  // prefix of the account as if it were the whole thing.
  const isPartialView = collection?.truncated ?? false;
  const updateStatusMutation = useUpdateApplicationStatus();

  // Client-side filtering for multiple companies, activeOnly and the date range — none
  // of which `/applications` supports as a query parameter. Every row already carries
  // `createdAt` and `appliedAt`, so the date window needs no API change (WIC-1613).
  const applications = useMemo(() => {
    let filtered = rawApplications;

    if (filters.company && filters.company.length > 0) {
      filtered = filtered.filter((app) => filters.company!.includes(app.company));
    }

    if (filters.activeOnly) {
      filtered = filtered.filter((app) => ACTIVE_STATUSES.includes(app.status));
    }

    filtered = filterByDateRange(filtered, filters.dateRange);

    return filtered;
  }, [rawApplications, filters.company, filters.activeOnly, filters.dateRange]);

  // Pipeline stats for the summary bar
  const pipelineStats = useMemo(() => calculatePipelineStats(rawApplications), [rawApplications]);

  const handleStatusChange = (appId: string, newStatus: ApplicationStatus) => {
    const app = applications.find((a) => a.id === appId);
    if (!app) return;

    updateStatusMutation.mutate(
      { id: appId, status: newStatus, version: app.version },
      {
        onError: (error) => {
          console.error('Failed to update status:', error);
        },
      }
    );
  };

  /**
   * WIC-2079. This page mounts the only `<KanbanBoard>` in the app, and it used to pass no
   * `onDelete` at all — so `ApplicationCard.handleDelete` asked "Are you sure you want to
   * delete this application?", the user confirmed, and `onDelete?.(id)` resolved to undefined.
   * No request, no error, no feedback: the user was walked through confirming a destructive
   * action that could not happen. `useDeleteApplication` had existed and been unused since it
   * was written.
   *
   * The confirm itself stays in the card (there is no `ConfirmDialog` component in this repo;
   * native `confirm()` is the house style), so by the time this runs the user has already
   * agreed. This function's only job is the mutation and the failure path.
   *
   * Alerting on error follows `ResumeVariantsList.handleDelete` verbatim rather than the
   * `console.error`-only shape of `handleStatusChange` above. The difference is deliberate:
   * a failed status change leaves the board visibly unchanged, so the user can see nothing
   * happened, whereas a failed delete is indistinguishable from the bug being fixed here.
   * Silence on failure would reintroduce the exact defect through the error path.
   */
  const deleteApplication = useDeleteApplication();

  const handleDelete = (id: string) => {
    deleteApplication.mutate(id, {
      onError: (error) => {
        console.error('Failed to delete application:', error);
        alert('Failed to delete application. Please try again.');
      },
    });
  };

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Applications' },
  ];

  // Get unique companies from all applications (not just filtered ones) for the filter options
  const availableCompanies = Array.from(new Set(rawApplications.map((app) => app.company))).sort();
  const availableStatuses: ApplicationStatus[] = [
    'saved',
    'applied',
    'phone_screen',
    'interview',
    'offer',
    'rejected',
    'withdrawn',
  ];

  // An early return rather than a banner above the board, deliberately, and the same
  // reasoning as `ProjectDetail` (WIC-2227): it makes `pipelineStats` and the board's own
  // per-column empty states UNREACHABLE on the error path. Both derive from
  // `collection?.applications ?? []`, so leaving either rendered would keep the false claim
  // one careless edit from returning. The filter controls go with them — there is nothing
  // to filter, and offering to narrow a list that was never read is its own small lie.
  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Breadcrumb trail={breadcrumbTrail} />

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-neutral-900">Applications</h1>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">Failed to load your applications. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-neutral-900">Applications</h1>
      </div>

      {isPartialView && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800"
        >
          Showing the first {rawApplications.length} of {collection?.totalCount} applications. The
          counts below cover only what is shown — narrow the filters to see the rest.
        </div>
      )}

      {/* Pipeline Stats Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <PipelineStat
          value={pipelineStats.active}
          label="Active"
          valueClassName="text-neutral-900"
          unsettled={isPending}
        />
        <PipelineStat
          value={pipelineStats.overdue}
          label="Overdue"
          valueClassName="text-red-600"
          unsettled={isPending}
        />
        <PipelineStat
          value={pipelineStats.dueToday}
          label="Due Today"
          valueClassName="text-orange-600"
          unsettled={isPending}
        />
        <PipelineStat
          value={pipelineStats.dueSoon}
          label="Due Soon"
          valueClassName="text-yellow-600"
          unsettled={isPending}
        />
        <PipelineStat
          value={pipelineStats.stale}
          label={`Stale (${DEFAULT_STALE_THRESHOLD_DAYS}+ days)`}
          valueClassName="text-neutral-600"
          unsettled={isPending}
        />
      </div>

      <div className="mb-4 space-y-3">
        {/* Saved filter shortcuts - always visible */}
        <SavedFilterShortcuts onApplyFilter={setFilters} currentFilters={filters} />

        {/* Filter toggle button */}
        <div>
          <button
            onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            aria-expanded={isFilterPanelOpen}
            aria-label={isFilterPanelOpen ? 'Hide filters' : 'Show filters'}
          >
            <span className="text-lg" aria-hidden="true">
              {isFilterPanelOpen ? '▼' : '▶'}
            </span>
            <span>{isFilterPanelOpen ? 'Hide Filters' : 'Show Filters'}</span>
          </button>
        </div>

        {/* Collapsible filter panel */}
        {isFilterPanelOpen && (
          <div className="animate-in slide-in-from-top-2 duration-200">
            <FilterPanel
              onFilterChange={setFilters}
              activeFilters={filters}
              availableCompanies={availableCompanies}
              availableStatuses={availableStatuses}
            />
          </div>
        )}
      </div>

      {/*
        WIC-2079 AC-3, the Edit decision, recorded because it is deliberately NOT obvious:
        `onEdit` and `onCardClick` navigate to the same route, so the Edit button is a second
        tab stop that does exactly what the first one already does. That is a real (if small)
        cost, and dropping the button was the live alternative. It is kept, for two reasons.

        It is the only LABELLED affordance in the pair. The card's own activation is implicit —
        a pointer user has no way to know the card is clickable, and a screen-reader user hears
        an `<article>` with a summary label; "Edit Staff Engineer" is what actually announces
        the action. Removing it would make the destination discoverable only by guessing.

        And it puts a non-destructive control first in the bar. Tab order through the revealed
        bar is Edit then Delete; with Edit gone, tabbing off the card lands immediately on the
        only remaining control, which is the destructive one. Keeping a benign first stop is
        worth the duplicate destination.

        If the detail route ever grows a distinct edit mode (`/applications/:id/edit`), this
        prop is where it goes and the duplication disappears on its own.
      */}
      <KanbanBoard
        applications={applications}
        onStatusChange={handleStatusChange}
        onCardClick={(id) => navigate(`/applications/${id}`)}
        onEdit={(id) => navigate(`/applications/${id}`)}
        onDelete={handleDelete}
        loading={isPending}
      />

      <FloatingActionButton
        onClick={() => navigate('/applications/new')}
        icon="+"
        label="New Application"
        ariaLabel="Create new job application"
      />
    </div>
  );
}
