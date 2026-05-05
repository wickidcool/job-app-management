import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { useApplications } from '../hooks/useApplications';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  id: string;
  type: 'application' | 'company' | 'recent' | 'suggestion';
  title: string;
  subtitle?: string;
  path: string;
  icon?: string;
}

const RECENT_SEARCHES_KEY = 'wic-recent-searches';
const MAX_RECENT_SEARCHES = 5;

const SUGGESTED_FILTERS = [
  {
    id: 'interviews',
    title: 'Interviews This Week',
    path: '/applications?status=interview,phone_screen',
    icon: '🤝',
  },
  { id: 'needs-followup', title: 'Needs Follow-up', path: '/reports/stale', icon: '⏰' },
  {
    id: 'recently-applied',
    title: 'Recently Applied',
    path: '/applications?status=applied',
    icon: '📤',
  },
  { id: 'offers', title: 'Active Offers', path: '/applications?status=offer', icon: '🎉' },
];

// localStorage helpers
function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query: string) {
  if (!query.trim()) return;

  try {
    const recent = getRecentSearches();
    const updated = [query, ...recent.filter((q) => q !== query)].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prevQuery, setPrevQuery] = useState('');
  const [prevOpen, setPrevOpen] = useState(false);
  const navigate = useNavigate();
  const { data: applications = [] } = useApplications();

  // Load recent searches - recalculate when palette opens
  const recentSearches = useMemo(() => (open ? getRecentSearches() : []), [open]);

  const results = useCallback((): SearchResult[] => {
    if (!query.trim()) {
      // Show suggested filters and recent searches when no query
      const suggestions: SearchResult[] = SUGGESTED_FILTERS.map((filter) => ({
        id: filter.id,
        type: 'suggestion',
        title: filter.title,
        path: filter.path,
        icon: filter.icon,
      }));

      const recent: SearchResult[] = recentSearches.slice(0, 3).map((search, idx) => ({
        id: `recent-${idx}`,
        type: 'recent',
        title: search,
        path: `/applications?search=${encodeURIComponent(search)}`,
        icon: '🕐',
      }));

      const recentApps = applications.slice(0, 3).map((app) => ({
        id: app.id,
        type: 'application' as const,
        title: app.jobTitle,
        subtitle: app.company,
        path: `/applications/${app.id}`,
      }));

      return [...suggestions, ...recent, ...recentApps];
    }

    const lowerQuery = query.toLowerCase();

    // Check if query matches a suggested filter
    const matchedSuggestions: SearchResult[] = SUGGESTED_FILTERS.filter((filter) =>
      filter.title.toLowerCase().includes(lowerQuery)
    ).map((filter) => ({
      id: filter.id,
      type: 'suggestion',
      title: filter.title,
      path: filter.path,
      icon: filter.icon,
    }));

    const appResults: SearchResult[] = applications
      .filter(
        (app) =>
          app.jobTitle.toLowerCase().includes(lowerQuery) ||
          app.company.toLowerCase().includes(lowerQuery) ||
          app.status.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 8)
      .map((app) => ({
        id: app.id,
        type: 'application',
        title: app.jobTitle,
        subtitle: `${app.company} • ${app.status.replace('_', ' ')}`,
        path: `/applications/${app.id}`,
      }));

    const uniqueCompanies = Array.from(
      new Set(
        applications
          .filter((app) => app.company.toLowerCase().includes(lowerQuery))
          .map((app) => app.company)
      )
    ).slice(0, 3);

    const companyResults: SearchResult[] = uniqueCompanies.map((company, idx) => ({
      id: `company-${idx}`,
      type: 'company',
      title: company,
      subtitle: `${applications.filter((app) => app.company === company).length} applications`,
      path: `/applications?company=${encodeURIComponent(company)}`,
    }));

    return [...matchedSuggestions, ...appResults, ...companyResults];
  }, [query, applications, recentSearches]);

  const searchResults = results();

  // Derived state pattern to reset selected index when query changes
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  // Derived state pattern to reset state when modal closes
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault();
      navigate(searchResults[selectedIndex].path);
      onOpenChange(false);
    }
  };

  const handleResultClick = (path: string) => {
    // Save search query to recent searches if it was a search
    if (query.trim()) {
      addRecentSearch(query);
    }
    navigate(path);
    onOpenChange(false);
  };

  const getResultIcon = (result: SearchResult) => {
    if (result.icon) return result.icon;

    switch (result.type) {
      case 'application':
        return '💼';
      case 'company':
        return '🏢';
      case 'recent':
        return '🕐';
      case 'suggestion':
        return '✨';
      default:
        return '📄';
    }
  };

  const getResultBgColor = (result: SearchResult) => {
    switch (result.type) {
      case 'application':
        return 'bg-blue-100';
      case 'company':
        return 'bg-purple-100';
      case 'recent':
        return 'bg-neutral-100';
      case 'suggestion':
        return 'bg-primary-100';
      default:
        return 'bg-neutral-100';
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[20%] z-50 w-full max-w-2xl translate-x-[-50%] translate-y-[-20%] rounded-lg bg-white shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <div className="flex flex-col">
            <div className="flex items-center border-b border-neutral-200 px-4">
              <svg
                className="h-5 w-5 text-neutral-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search applications, companies, or statuses..."
                className="w-full border-0 bg-transparent px-3 py-4 text-base outline-none placeholder:text-neutral-400"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <kbd className="hidden rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs text-neutral-500 sm:inline-block">
                ESC
              </kbd>
            </div>

            {searchResults.length > 0 ? (
              <div className="max-h-[400px] overflow-y-auto p-2">
                {!query && (
                  <>
                    {/* Suggested Filters Section */}
                    {searchResults.some((r) => r.type === 'suggestion') && (
                      <div className="mb-3">
                        <div className="text-xs font-medium text-neutral-500 px-3 py-2">
                          Suggested Filters
                        </div>
                        {searchResults
                          .filter((r) => r.type === 'suggestion')
                          .map((result) => {
                            const globalIndex = searchResults.indexOf(result);
                            return (
                              <button
                                key={result.id}
                                onClick={() => handleResultClick(result.path)}
                                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                                  globalIndex === selectedIndex
                                    ? 'bg-primary-50 text-primary-900'
                                    : 'text-neutral-900 hover:bg-neutral-100'
                                }`}
                              >
                                <div
                                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xl ${getResultBgColor(result)}`}
                                >
                                  {getResultIcon(result)}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <div className="truncate font-medium">{result.title}</div>
                                  {result.subtitle && (
                                    <div className="truncate text-sm text-neutral-500">
                                      {result.subtitle}
                                    </div>
                                  )}
                                </div>
                                <svg
                                  className="h-4 w-4 flex-shrink-0 text-neutral-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </button>
                            );
                          })}
                      </div>
                    )}

                    {/* Recent Searches Section */}
                    {searchResults.some((r) => r.type === 'recent') && (
                      <div className="mb-3">
                        <div className="text-xs font-medium text-neutral-500 px-3 py-2">
                          Recent Searches
                        </div>
                        {searchResults
                          .filter((r) => r.type === 'recent')
                          .map((result) => {
                            const globalIndex = searchResults.indexOf(result);
                            return (
                              <button
                                key={result.id}
                                onClick={() => handleResultClick(result.path)}
                                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                                  globalIndex === selectedIndex
                                    ? 'bg-primary-50 text-primary-900'
                                    : 'text-neutral-900 hover:bg-neutral-100'
                                }`}
                              >
                                <div
                                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xl ${getResultBgColor(result)}`}
                                >
                                  {getResultIcon(result)}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <div className="truncate font-medium">{result.title}</div>
                                </div>
                                <svg
                                  className="h-4 w-4 flex-shrink-0 text-neutral-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </button>
                            );
                          })}
                      </div>
                    )}

                    {/* Recent Applications Section */}
                    {searchResults.some((r) => r.type === 'application') && (
                      <div>
                        <div className="text-xs font-medium text-neutral-500 px-3 py-2">
                          Recent Applications
                        </div>
                        {searchResults
                          .filter((r) => r.type === 'application')
                          .map((result) => {
                            const globalIndex = searchResults.indexOf(result);
                            return (
                              <button
                                key={result.id}
                                onClick={() => handleResultClick(result.path)}
                                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                                  globalIndex === selectedIndex
                                    ? 'bg-primary-50 text-primary-900'
                                    : 'text-neutral-900 hover:bg-neutral-100'
                                }`}
                              >
                                <div
                                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xl ${getResultBgColor(result)}`}
                                >
                                  {getResultIcon(result)}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <div className="truncate font-medium">{result.title}</div>
                                  {result.subtitle && (
                                    <div className="truncate text-sm text-neutral-500">
                                      {result.subtitle}
                                    </div>
                                  )}
                                </div>
                                <svg
                                  className="h-4 w-4 flex-shrink-0 text-neutral-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </>
                )}

                {query && (
                  <>
                    <div className="text-xs font-medium text-neutral-500 px-3 py-2">Results</div>
                    {searchResults.map((result, index) => (
                      <button
                        key={result.id}
                        onClick={() => handleResultClick(result.path)}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                          index === selectedIndex
                            ? 'bg-primary-50 text-primary-900'
                            : 'text-neutral-900 hover:bg-neutral-100'
                        }`}
                      >
                        <div
                          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xl ${getResultBgColor(result)}`}
                        >
                          {getResultIcon(result)}
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate font-medium">{result.title}</div>
                          {result.subtitle && (
                            <div className="truncate text-sm text-neutral-500">
                              {result.subtitle}
                            </div>
                          )}
                        </div>
                        <svg
                          className="h-4 w-4 flex-shrink-0 text-neutral-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-neutral-500">
                <div className="text-4xl mb-2">🔍</div>
                <p>No results found</p>
              </div>
            )}

            <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
              <div className="flex items-center justify-between">
                <span>Navigate with arrow keys</span>
                <span className="flex gap-2">
                  <kbd className="rounded border border-neutral-300 bg-white px-2 py-0.5">↑↓</kbd>
                  to navigate
                  <kbd className="rounded border border-neutral-300 bg-white px-2 py-0.5">↵</kbd>
                  to select
                </span>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
