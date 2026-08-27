import type { ApplicationStatus } from '../types/application';

export interface FilterOptions {
  search?: string;
  status?: ApplicationStatus[];
  company?: string[];
  dateRange?: { start: Date; end: Date };
  activeOnly?: boolean;
}

export interface FilterPanelProps {
  onFilterChange: (filters: FilterOptions) => void;
  activeFilters: FilterOptions;
  availableCompanies: string[];
  availableStatuses: ApplicationStatus[];
}

const statusLabels: Record<ApplicationStatus, { label: string; icon: string }> = {
  saved: { label: 'Saved', icon: '📥' },
  applied: { label: 'Applied', icon: '📤' },
  phone_screen: { label: 'Phone Screen', icon: '📞' },
  interview: { label: 'Interview', icon: '🤝' },
  offer: { label: 'Offer', icon: '🎉' },
  rejected: { label: 'Rejected', icon: '❌' },
  withdrawn: { label: 'Withdrawn', icon: '↩️' },
};

export function FilterPanel({
  onFilterChange,
  activeFilters,
  availableCompanies,
  availableStatuses,
}: FilterPanelProps) {
  // This panel is CONTROLLED, and holds no state of its own at all: `activeFilters` is
  // the single source of truth for every control below, and `onFilterChange` is the
  // only writer.
  //
  // It has to be, because the panel is not the only writer to that state. On
  // `/applications`, `SavedFilterShortcuts` sits directly above it and writes the same
  // page state through `onApplyFilter`. Until WIC-1612 this component copied the prop
  // into four `useState`s, whose initialisers run on first mount only — so every
  // shortcut applied while the panel was open stayed invisible here. The panel showed
  // nothing checked and hid `Clear All` over a list that really was filtered, disagreed
  // with the shortcuts bar rendered inches above it, and worst, the next toggle spread
  // its own stale `[]` and discarded statuses the user had never touched.
  //
  // Deriving needs no sync effect and cannot go stale. The search box's 300ms debounce,
  // which was the one honest reason to keep local state here, now sits on the page
  // between `filters` and the API (`ApplicationsList`), so keystrokes still do not cost
  // a request each.
  const selectedStatuses: ApplicationStatus[] = activeFilters.status ?? [];
  const selectedCompanies: string[] = activeFilters.company ?? [];
  const activeOnly = activeFilters.activeOnly ?? false;
  const searchInput = activeFilters.search ?? '';

  const handleStatusToggle = (status: ApplicationStatus) => {
    const newStatuses = selectedStatuses.includes(status)
      ? selectedStatuses.filter((s) => s !== status)
      : [...selectedStatuses, status];

    onFilterChange({
      ...activeFilters,
      status: newStatuses.length > 0 ? newStatuses : undefined,
    });
  };

  const handleCompanyToggle = (company: string) => {
    const newCompanies = selectedCompanies.includes(company)
      ? selectedCompanies.filter((c) => c !== company)
      : [...selectedCompanies, company];

    onFilterChange({
      ...activeFilters,
      company: newCompanies.length > 0 ? newCompanies : undefined,
    });
  };

  const handleActiveOnlyToggle = () => {
    const newActiveOnly = !activeOnly;
    onFilterChange({
      ...activeFilters,
      activeOnly: newActiveOnly || undefined,
    });
  };

  const handleClearAll = () => {
    onFilterChange({});
  };

  const handleRemoveStatusFilter = (status: ApplicationStatus) => {
    const newStatuses = selectedStatuses.filter((s) => s !== status);
    onFilterChange({
      ...activeFilters,
      status: newStatuses.length > 0 ? newStatuses : undefined,
    });
  };

  const handleRemoveCompanyFilter = (company: string) => {
    const newCompanies = selectedCompanies.filter((c) => c !== company);
    onFilterChange({
      ...activeFilters,
      company: newCompanies.length > 0 ? newCompanies : undefined,
    });
  };

  // Computed from the prop for the same reason as the controls above: read off the
  // stale local copies, this hid the whole chip row and `Clear All` for exactly as long
  // as a shortcut was the thing that had applied the filters.
  const hasActiveFilters = Boolean(
    activeFilters.search ||
    selectedStatuses.length > 0 ||
    selectedCompanies.length > 0 ||
    activeOnly
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      {/* Search Input */}
      <div>
        <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-2">
          Search
        </label>
        <input
          id="search"
          type="text"
          value={searchInput}
          onChange={(e) =>
            onFilterChange({ ...activeFilters, search: e.target.value || undefined })
          }
          placeholder="Search by job title or company..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Search applications"
        />
      </div>

      {/* Active Only Toggle */}
      <div className="flex items-center justify-between py-2">
        <label
          htmlFor="activeOnly"
          className="text-sm font-medium text-gray-700 cursor-pointer"
          onClick={handleActiveOnlyToggle}
        >
          Active Only
        </label>
        <button
          id="activeOnly"
          role="switch"
          aria-checked={activeOnly}
          onClick={handleActiveOnlyToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            activeOnly ? 'bg-blue-600' : 'bg-gray-200'
          }`}
          style={{ minHeight: '44px', minWidth: '44px' }}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              activeOnly ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p className="text-xs text-gray-500 -mt-2 mb-2">
        Hide terminal statuses (Offer, Rejected, Withdrawn)
      </p>

      {/* Status Filter - Touch-optimized */}
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">Status</div>
        <div className="space-y-1">
          {availableStatuses.map((status) => (
            <label
              key={status}
              className="flex items-center gap-3 cursor-pointer py-2 px-1 -mx-1 rounded hover:bg-gray-50"
              style={{ minHeight: '44px' }}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes(status)}
                onChange={() => handleStatusToggle(status)}
                className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                aria-label={`Filter by ${statusLabels[status].label}`}
              />
              <span className="text-sm">
                {statusLabels[status].icon} {statusLabels[status].label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Company Filter - Touch-optimized */}
      {availableCompanies.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Company</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {availableCompanies.map((company) => (
              <label
                key={company}
                className="flex items-center gap-3 cursor-pointer py-2 px-1 -mx-1 rounded hover:bg-gray-50"
                style={{ minHeight: '44px' }}
              >
                <input
                  type="checkbox"
                  checked={selectedCompanies.includes(company)}
                  onChange={() => handleCompanyToggle(company)}
                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  aria-label={`Filter by company ${company}`}
                />
                <span className="text-sm">{company}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Active Filters */}
      {hasActiveFilters && (
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Active Filters:</span>
            <button
              onClick={handleClearAll}
              className="px-3 py-2 text-sm text-blue-600 hover:text-blue-700 font-medium rounded hover:bg-blue-50"
              style={{ minHeight: '44px' }}
              aria-label="Clear all filters"
            >
              Clear All
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Search chip - Touch-optimized */}
            {activeFilters.search && (
              <div className="inline-flex items-center gap-1 px-3 py-2 bg-blue-100 text-blue-800 rounded-md text-sm">
                <span>Search: {activeFilters.search}</span>
                <button
                  onClick={() => onFilterChange({ ...activeFilters, search: undefined })}
                  className="ml-1 hover:text-blue-900 p-1"
                  style={{ minWidth: '24px', minHeight: '24px' }}
                  aria-label={`Remove search filter: ${activeFilters.search}`}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Status chips - Touch-optimized */}
            {selectedStatuses.map((status) => (
              <div
                key={status}
                className="inline-flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-800 rounded-md text-sm"
              >
                <span>
                  {statusLabels[status].icon} {statusLabels[status].label}
                </span>
                <button
                  onClick={() => handleRemoveStatusFilter(status)}
                  className="ml-1 hover:text-gray-900 p-1"
                  style={{ minWidth: '24px', minHeight: '24px' }}
                  aria-label={`Remove ${statusLabels[status].label} filter`}
                >
                  ✕
                </button>
              </div>
            ))}

            {/* Company chips - Touch-optimized */}
            {selectedCompanies.map((company) => (
              <div
                key={company}
                className="inline-flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-800 rounded-md text-sm"
              >
                <span>{company}</span>
                <button
                  onClick={() => handleRemoveCompanyFilter(company)}
                  className="ml-1 hover:text-gray-900 p-1"
                  style={{ minWidth: '24px', minHeight: '24px' }}
                  aria-label={`Remove company filter: ${company}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
