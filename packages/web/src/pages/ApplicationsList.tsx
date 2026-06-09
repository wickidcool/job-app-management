import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';
import { Breadcrumb } from '../components/Breadcrumb';
import { KanbanBoard } from '../components/KanbanBoard';
import { ApplicationsTable } from '../components/ApplicationsTable';
import { FilterPanel, type FilterOptions } from '../components/FilterPanel';
import { SavedFilterShortcuts } from '../components/SavedFilterShortcuts';
import { FloatingActionButton } from '../components/FloatingActionButton';
import { useApplications, useUpdateApplicationStatus } from '../hooks/useApplications';
import type { Application, ApplicationStatus } from '../types/application';

const ACTIVE_STATUSES: ApplicationStatus[] = ['saved', 'applied', 'phone_screen', 'interview'];

type ViewMode = 'kanban' | 'table';
const VIEW_MODE_STORAGE_KEY = 'applications-view-mode';

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

    const daysSinceUpdate = differenceInDays(today, new Date(app.updatedAt));
    if (daysSinceUpdate >= 14) stale++;
  }

  return { active: activeApps.length, overdue, dueToday, dueSoon, stale };
}

export function ApplicationsList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterOptions>({});
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  // Load view mode from localStorage or default to kanban
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'table' || stored === 'kanban' ? stored : 'kanban';
  });

  // Persist view mode to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  // Convert FilterOptions to API filter format
  const apiFilters = useMemo(
    () => ({
      status: filters.status,
      search: filters.search,
      // API only supports single company partial match, not multiple exact matches
      // We'll handle multiple companies via client-side filtering
      company: undefined,
    }),
    [filters.status, filters.search]
  );

  const { data: rawApplications = [], isLoading } = useApplications(apiFilters);
  const updateStatusMutation = useUpdateApplicationStatus();

  // Client-side filtering for multiple companies and activeOnly (API doesn't support these)
  const applications = useMemo(() => {
    let filtered = rawApplications;

    if (filters.company && filters.company.length > 0) {
      filtered = filtered.filter((app) => filters.company!.includes(app.company));
    }

    if (filters.activeOnly) {
      filtered = filtered.filter((app) => ACTIVE_STATUSES.includes(app.status));
    }

    return filtered;
  }, [rawApplications, filters.company, filters.activeOnly]);

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-neutral-900">Applications</h1>

        {/* View mode toggle */}
        <div className="flex items-center gap-2 bg-white border border-neutral-300 rounded-md p-1">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
              viewMode === 'kanban'
                ? 'bg-blue-600 text-white'
                : 'text-neutral-700 hover:bg-neutral-100'
            }`}
            aria-pressed={viewMode === 'kanban'}
          >
            Kanban
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
              viewMode === 'table'
                ? 'bg-blue-600 text-white'
                : 'text-neutral-700 hover:bg-neutral-100'
            }`}
            aria-pressed={viewMode === 'table'}
          >
            Table
          </button>
        </div>
      </div>

      {/* Pipeline Stats Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-2xl font-bold text-neutral-900">{pipelineStats.active}</div>
          <div className="text-sm text-neutral-600">Active</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-2xl font-bold text-red-600">{pipelineStats.overdue}</div>
          <div className="text-sm text-neutral-600">Overdue</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-2xl font-bold text-orange-600">{pipelineStats.dueToday}</div>
          <div className="text-sm text-neutral-600">Due Today</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-2xl font-bold text-yellow-600">{pipelineStats.dueSoon}</div>
          <div className="text-sm text-neutral-600">Due Soon</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-2xl font-bold text-neutral-600">{pipelineStats.stale}</div>
          <div className="text-sm text-neutral-600">Stale (14+ days)</div>
        </div>
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

      {viewMode === 'kanban' ? (
        <KanbanBoard
          applications={applications}
          onStatusChange={handleStatusChange}
          onCardClick={(id) => navigate(`/applications/${id}`)}
          onEdit={(id) => navigate(`/applications/${id}`)}
          loading={isLoading}
        />
      ) : (
        <ApplicationsTable
          applications={applications}
          onRowClick={(id) => navigate(`/applications/${id}`)}
        />
      )}

      <FloatingActionButton
        onClick={() => navigate('/applications/new')}
        icon="+"
        label="New Application"
        ariaLabel="Create new job application"
      />
    </div>
  );
}
