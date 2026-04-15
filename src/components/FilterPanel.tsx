import { useState, useEffect } from 'react';
import type { ApplicationStatus } from '../types/application';

export interface FilterOptions {
  search?: string;
  status?: ApplicationStatus[];
  company?: string[];
  dateRange?: { start: Date; end: Date };
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

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function FilterPanel({
  onFilterChange,
  activeFilters,
  availableCompanies,
  availableStatuses,
}: FilterPanelProps) {
  const [searchInput, setSearchInput] = useState(activeFilters.search || '');
  const [selectedStatuses, setSelectedStatuses] = useState<ApplicationStatus[]>(
    activeFilters.status || []
  );
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>(
    activeFilters.company || []
  );

  const debouncedSearch = useDebounce(searchInput, 300);

  // Update filters when debounced search changes
  useEffect(() => {
    const newFilters: FilterOptions = {
      ...activeFilters,
      search: debouncedSearch || undefined,
    };
    onFilterChange(newFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleStatusToggle = (status: ApplicationStatus) => {
    const newStatuses = selectedStatuses.includes(status)
      ? selectedStatuses.filter((s) => s !== status)
      : [...selectedStatuses, status];

    setSelectedStatuses(newStatuses);
    onFilterChange({
      ...activeFilters,
      status: newStatuses.length > 0 ? newStatuses : undefined,
    });
  };

  const handleCompanyToggle = (company: string) => {
    const newCompanies = selectedCompanies.includes(company)
      ? selectedCompanies.filter((c) => c !== company)
      : [...selectedCompanies, company];

    setSelectedCompanies(newCompanies);
    onFilterChange({
      ...activeFilters,
      company: newCompanies.length > 0 ? newCompanies : undefined,
    });
  };

  const handleClearAll = () => {
    setSearchInput('');
    setSelectedStatuses([]);
    setSelectedCompanies([]);
    onFilterChange({});
  };

  const handleRemoveStatusFilter = (status: ApplicationStatus) => {
    const newStatuses = selectedStatuses.filter((s) => s !== status);
    setSelectedStatuses(newStatuses);
    onFilterChange({
      ...activeFilters,
      status: newStatuses.length > 0 ? newStatuses : undefined,
    });
  };

  const handleRemoveCompanyFilter = (company: string) => {
    const newCompanies = selectedCompanies.filter((c) => c !== company);
    setSelectedCompanies(newCompanies);
    onFilterChange({
      ...activeFilters,
      company: newCompanies.length > 0 ? newCompanies : undefined,
    });
  };

  const hasActiveFilters =
    searchInput || selectedStatuses.length > 0 || selectedCompanies.length > 0;

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
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by job title or company..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Search applications"
        />
      </div>

      {/* Status Filter */}
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">Status</div>
        <div className="space-y-2">
          {availableStatuses.map((status) => (
            <label key={status} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedStatuses.includes(status)}
                onChange={() => handleStatusToggle(status)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                aria-label={`Filter by ${statusLabels[status].label}`}
              />
              <span className="text-sm">
                {statusLabels[status].icon} {statusLabels[status].label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Company Filter */}
      {availableCompanies.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Company</div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {availableCompanies.map((company) => (
              <label key={company} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedCompanies.includes(company)}
                  onChange={() => handleCompanyToggle(company)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
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
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              aria-label="Clear all filters"
            >
              Clear All
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Search chip */}
            {searchInput && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs">
                <span>Search: {searchInput}</span>
                <button
                  onClick={() => setSearchInput('')}
                  className="hover:text-blue-900"
                  aria-label={`Remove search filter: ${searchInput}`}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Status chips */}
            {selectedStatuses.map((status) => (
              <div
                key={status}
                className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-md text-xs"
              >
                <span>
                  {statusLabels[status].icon} {statusLabels[status].label}
                </span>
                <button
                  onClick={() => handleRemoveStatusFilter(status)}
                  className="hover:text-gray-900"
                  aria-label={`Remove ${statusLabels[status].label} filter`}
                >
                  ✕
                </button>
              </div>
            ))}

            {/* Company chips */}
            {selectedCompanies.map((company) => (
              <div
                key={company}
                className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-md text-xs"
              >
                <span>{company}</span>
                <button
                  onClick={() => handleRemoveCompanyFilter(company)}
                  className="hover:text-gray-900"
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
