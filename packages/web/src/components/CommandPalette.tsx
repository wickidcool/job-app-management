import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { useApplications } from '../hooks/useApplications';
import { FILTER_SHORTCUT_LABELS } from '../constants/filterShortcuts';

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
    title: FILTER_SHORTCUT_LABELS.interviewing,
    path: '/applications?status=interview,phone_screen',
    icon: '🤝',
  },
  {
    id: 'needs-followup',
    title: FILTER_SHORTCUT_LABELS.needsFollowUp,
    path: '/reports/stale',
    icon: '⏰',
  },
  {
    id: 'recently-applied',
    title: FILTER_SHORTCUT_LABELS.applied,
    path: '/applications?status=applied',
    icon: '📤',
  },
  {
    id: 'offers',
    title: FILTER_SHORTCUT_LABELS.activeOffers,
    path: '/applications?status=offer',
    icon: '🎉',
  },
];

function getResultIcon(result: SearchResult) {
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
}

function getResultBgColor(result: SearchResult) {
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
}

/**
 * The spoken counterpart to the result-type emoji (WIC-1850).
 *
 * Keyed on `type`, never on the glyph: `result.icon` lets a caller override the emoji
 * (`SUGGESTED_FILTERS` all do), so deriving the label from the icon would leave the four
 * suggested filters unlabelled and mislabel nothing else usefully.
 */
function getResultTypeLabel(result: SearchResult) {
  switch (result.type) {
    case 'application':
      return 'Application';
    case 'company':
      return 'Company';
    case 'recent':
      return 'Recent search';
    case 'suggestion':
      return 'Suggested filter';
    default:
      return 'Result';
  }
}

/**
 * The type badge on a result row: the glyph for sighted users, the word for everyone else.
 *
 * Both halves are here on purpose, because on this surface the pair is the fix and neither
 * half is (WIC-1850). Without `aria-hidden` the emoji joins the enclosing button's
 * *accessible name*, so every row is announced as "briefcase Senior Engineer, button" — and
 * the palette is arrow-key navigated, so that is heard once per keystroke rather than once
 * per page. But `aria-hidden` alone would drop information: the emoji is the only signal
 * that distinguishes one result type from another. `getResultBgColor` is purely visual, and
 * `subtitle` carries no type at all for `suggestion` and `recent` (they have none) and
 * nothing type-shaped for `application` (it is the company). So the glyph is replaced by an
 * `sr-only` label rather than merely silenced.
 *
 * Rendered as one component rather than repeated at each of the four call sites so that a
 * fifth row cannot pick up the emoji without the label. See the decorative-glyph rule in
 * docs/design/ACCESSIBILITY.md.
 */
function ResultTypeBadge({ result }: { result: SearchResult }) {
  return (
    <>
      <div
        aria-hidden="true"
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xl ${getResultBgColor(result)}`}
      >
        {getResultIcon(result)}
      </div>
      <span className="sr-only">{getResultTypeLabel(result)}:</span>
    </>
  );
}

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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[20%] z-50 w-full max-w-2xl translate-x-[-50%] translate-y-[-20%] rounded-lg bg-white shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          {/*
            The dialog's own name and description (WIC-1851). Without these the palette
            opened as an unnamed "dialog" — SC 4.1.2 — on the surface a keyboard-first user
            reaches most often, and Radix said so on every mount.

            Neither may carry an `id` prop. Radix's `TitleWarning` / `DescriptionWarning`
            look up `context.titleId` / `context.descriptionId` with `getElementById`
            (@radix-ui/react-dialog 1.1.15, dist/index.mjs:295 and :308), so overriding the
            id leaves the lookup empty and the console warning fires even though the markup
            is correct. `ApplicationForm.tsx:227` does override it and warns for that reason
            — follow the wiring here, not that call site's ids.

            Both are `sr-only` rather than visible: the palette's whole visual design is that
            it appears with nothing above the search field.

            Pointing `aria-describedby` at the footer instead — one copy of the instructions
            rather than two — was tried and rejected. The footer is written to be glanced at,
            so it reads as a stutter aloud ("Navigate with arrow keys, up and down arrow keys
            to navigate…"), and it says nothing about typing, which is the affordance a
            first-time listener actually needs. The two texts are close enough that a change
            to the key handling must update both; `handleKeyDown` is the thing to grep.
          */}
          <Dialog.Title className="sr-only">Quick search</Dialog.Title>
          <Dialog.Description className="sr-only">
            Type to search applications, companies, and statuses. Use the up and down arrow keys to
            move between results, and Enter to open one.
          </Dialog.Description>

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
                                <ResultTypeBadge result={result} />
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
                                <ResultTypeBadge result={result} />
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
                                <ResultTypeBadge result={result} />
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
                        <ResultTypeBadge result={result} />
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
                {/* Purely decorative — "No results found" below says the same thing, so
                    unlike the row glyphs this one needs no `sr-only` replacement. Without
                    aria-hidden it is read out as "magnifying glass tilted left" first
                    (WIC-1850). */}
                <div className="text-4xl mb-2" aria-hidden="true">
                  🔍
                </div>
                <p>No results found</p>
              </div>
            )}

            <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
              <div className="flex items-center justify-between">
                <span>Navigate with arrow keys</span>
                <span className="flex gap-2">
                  {/*
                    Key glyphs, not decoration (WIC-1851). These carry the whole instruction —
                    remove them and the sentence is "to navigate … to select" — so the
                    decorative-glyph rule's `aria-hidden`-alone branch does not apply. But left
                    bare they are announced by Unicode name: ↵ is "downwards arrow with corner
                    leftwards", which is not a key any listener can find. So each is hidden and
                    replaced by the key's spoken name, the same hidden-plus-`sr-only` shape
                    WIC-1850 used on the result rows, and the footer reads as "Up and down arrow
                    keys to navigate, Enter to select".
                  */}
                  <kbd className="rounded border border-neutral-300 bg-white px-2 py-0.5">
                    <span aria-hidden="true">↑↓</span>
                    <span className="sr-only">Up and down arrow keys</span>
                  </kbd>
                  to navigate
                  <kbd className="rounded border border-neutral-300 bg-white px-2 py-0.5">
                    <span aria-hidden="true">↵</span>
                    <span className="sr-only">Enter</span>
                  </kbd>
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
