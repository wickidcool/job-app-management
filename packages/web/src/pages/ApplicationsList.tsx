import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { KanbanBoard } from '../components/KanbanBoard';
import { FilterPanel, type FilterOptions } from '../components/FilterPanel';
import { SavedFilterShortcuts } from '../components/SavedFilterShortcuts';
import { FloatingActionButton } from '../components/FloatingActionButton';
import { useApplications, useUpdateApplicationStatus } from '../hooks/useApplications';
import type { ApplicationStatus } from '../types/application';

export function ApplicationsList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterOptions>({});
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  // Convert FilterOptions to API filter format
  const apiFilters = useMemo(() => ({
    status: filters.status,
    search: filters.search,
    // API only supports single company partial match, not multiple exact matches
    // We'll handle multiple companies via client-side filtering
    company: undefined,
  }), [filters.status, filters.search]);

  const { data: rawApplications = [], isLoading } = useApplications(apiFilters);
  const updateStatusMutation = useUpdateApplicationStatus();

  // Client-side filtering for multiple companies (API doesn't support this)
  const applications = useMemo(() => {
    if (!filters.company || filters.company.length === 0) {
      return rawApplications;
    }
    return rawApplications.filter((app) => filters.company!.includes(app.company));
  }, [rawApplications, filters.company]);

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
  const availableCompanies = Array.from(
    new Set(rawApplications.map((app) => app.company))
  ).sort();
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
      </div>

      <div className="mb-4 space-y-3">
        {/* Saved filter shortcuts - always visible */}
        <SavedFilterShortcuts
          onApplyFilter={setFilters}
          currentFilters={filters}
        />

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

      <KanbanBoard
        applications={applications}
        onStatusChange={handleStatusChange}
        onCardClick={(id) => navigate(`/applications/${id}`)}
        onEdit={(id) => navigate(`/applications/${id}`)}
        loading={isLoading}
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
