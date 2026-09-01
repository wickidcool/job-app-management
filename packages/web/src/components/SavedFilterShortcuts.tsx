import { useState } from 'react';
import type { FilterOptions } from './FilterPanel';
import type { ApplicationStatus } from '../types/application';
import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';

interface SavedFilterShortcutsProps {
  onApplyFilter: (filters: FilterOptions) => void;
  currentFilters: FilterOptions;
}

interface FilterShortcut {
  id: string;
  name: string;
  filters: FilterOptions;
  isPredefined: boolean;
}

const SAVED_FILTERS_KEY = 'wic-saved-filters';

const PREDEFINED_SHORTCUTS: FilterShortcut[] = [
  {
    id: 'needs-followup',
    name: FILTER_SHORTCUT_LABELS.needsFollowUp,
    filters: {
      status: ['saved', 'applied', 'phone_screen'] as ApplicationStatus[],
    },
    isPredefined: true,
  },
  {
    id: 'interviews-this-week',
    name: FILTER_SHORTCUT_LABELS.interviewing,
    filters: {
      status: ['interview', 'phone_screen'] as ApplicationStatus[],
    },
    isPredefined: true,
  },
  {
    id: 'recently-applied',
    name: FILTER_SHORTCUT_LABELS.applied,
    filters: {
      status: ['applied'] as ApplicationStatus[],
    },
    isPredefined: true,
  },
  {
    id: 'active-offers',
    name: FILTER_SHORTCUT_LABELS.activeOffers,
    filters: {
      status: ['offer'] as ApplicationStatus[],
    },
    isPredefined: true,
  },
];

function getSavedFilters(): FilterShortcut[] {
  try {
    const stored = localStorage.getItem(SAVED_FILTERS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFilters(filters: FilterShortcut[]) {
  try {
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Ignore localStorage errors
  }
}

export function SavedFilterShortcuts({ onApplyFilter, currentFilters }: SavedFilterShortcutsProps) {
  const [customFilters, setCustomFilters] = useState<FilterShortcut[]>(() => getSavedFilters());
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');

  const allShortcuts = [...PREDEFINED_SHORTCUTS, ...customFilters];

  const handleApplyShortcut = (shortcut: FilterShortcut) => {
    onApplyFilter(shortcut.filters);
  };

  const handleSaveCurrentFilter = () => {
    if (!newFilterName.trim()) return;

    const newShortcut: FilterShortcut = {
      id: `custom-${Date.now()}`,
      name: newFilterName.trim(),
      filters: currentFilters,
      isPredefined: false,
    };

    const updated = [...customFilters, newShortcut];
    setCustomFilters(updated);
    saveFilters(updated);
    setNewFilterName('');
    setShowSaveDialog(false);
  };

  const handleDeleteCustomFilter = (id: string) => {
    const updated = customFilters.filter((f) => f.id !== id);
    setCustomFilters(updated);
    saveFilters(updated);
  };

  // This gates "+ Save Current", and it has to agree with `FilterPanel`'s own
  // `hasActiveFilters` — the two bars render inches apart, and WIC-1612 was largely
  // about them disagreeing. WIC-1613 adds `dateRange`, without which a window the user
  // had just set would be unsaveable while the panel below offered `Clear All` over
  // filters this bar denied were active. `activeOnly` was missing for the same reason
  // and is added with it.
  const hasActiveFilters = Boolean(
    currentFilters.search ||
    currentFilters.status?.length ||
    currentFilters.company?.length ||
    currentFilters.activeOnly ||
    currentFilters.dateRange?.start ||
    currentFilters.dateRange?.end
  );

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4">
      <div className="flex items-center justify-between mb-3">
        {/* h2, not h3: this panel is a direct child of the `/applications` page h1, so an
            h3 here left the route opening h1 -> h3 with nothing in between (WIC-1675
            AC-2). The visual size is carried by the class, not the tag. */}
        <h2 className="text-sm font-medium text-neutral-700">Filter Shortcuts</h2>
        {hasActiveFilters && !showSaveDialog && (
          <button
            onClick={() => setShowSaveDialog(true)}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1 rounded hover:bg-primary-50"
          >
            + Save Current
          </button>
        )}
      </div>

      {showSaveDialog && (
        <div className="mb-3 p-3 bg-primary-50 rounded-lg border border-primary-200">
          <label htmlFor="filter-name" className="block text-xs font-medium text-neutral-700 mb-2">
            Save current filters as:
          </label>
          <div className="flex gap-2">
            <input
              id="filter-name"
              type="text"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
              placeholder="My Filter"
              className="flex-1 px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCurrentFilter();
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
            />
            <button
              onClick={handleSaveCurrentFilter}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
            >
              Save
            </button>
            <button
              onClick={() => {
                setShowSaveDialog(false);
                setNewFilterName('');
              }}
              className="px-3 py-1.5 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {allShortcuts.map((shortcut) => (
          <div key={shortcut.id} className="inline-flex items-center gap-1">
            <button
              onClick={() => handleApplyShortcut(shortcut)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-md text-sm font-medium hover:bg-primary-100 transition-colors border border-primary-200"
            >
              {/* Decorative only — `isPredefined` is already conveyed by the absence of the
                  delete control. Without aria-hidden the emoji joins the button's accessible
                  name and is announced before every label (WIC-1846). */}
              {shortcut.isPredefined && (
                <span className="text-xs" aria-hidden="true">
                  ✨
                </span>
              )}
              {shortcut.name}
            </button>
            {!shortcut.isPredefined && (
              <button
                onClick={() => handleDeleteCustomFilter(shortcut.id)}
                className="p-1 text-neutral-400 hover:text-neutral-600 rounded"
                aria-label={`Delete ${shortcut.name} filter`}
                title="Delete filter"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        ))}

        {allShortcuts.length === 0 && (
          <p className="text-sm text-neutral-500">
            No saved filters yet. Apply some filters and click "Save Current" to create a shortcut.
          </p>
        )}
      </div>
    </div>
  );
}
