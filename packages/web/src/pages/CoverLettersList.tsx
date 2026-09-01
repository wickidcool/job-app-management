import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Breadcrumb } from '../components/Breadcrumb';
import { EmptyState } from '../components/EmptyState';
import { useCoverLetters } from '../hooks/useCoverLetters';

/**
 * The standing index of every cover letter, and the durable entry point to
 * `/cover-letters/:id`.
 *
 * Before this page, a letter's detail view was reachable only by the redirect
 * `CoverLetterNew` performs in the seconds after generation — and only on the
 * branch of that redirect taken when no application id is present. Navigate
 * away and export, delete, variant switching and the full preview all became
 * unreachable for good (WIC-1533).
 *
 * Deliberately shaped as a sibling of `ResumeVariantsList`: the two entities
 * have the same `(targetCompany, targetRole)` shape, the same draft/finalized
 * status, and the same "generate a new one" affordance, so they should not be
 * two different pages. The one departure is that rows here are real `<Link>`s
 * rather than a `role="button"` `<article>` with an `onClick`, so they can be
 * middle-clicked, opened in a new tab, and read as links by assistive tech.
 */
export function CoverLettersList() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'draft' | 'finalized' | ''>('');
  const [searchQuery, setSearchQuery] = useState('');

  const {
    data: coverLetters = [],
    isLoading,
    error,
  } = useCoverLetters({
    status: statusFilter || undefined,
    search: searchQuery || undefined,
  });

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Cover Letters' },
  ];

  const statusColors = {
    draft: 'bg-yellow-100 text-yellow-800',
    finalized: 'bg-green-100 text-green-800',
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-neutral-900">Cover Letters</h1>
        <Link
          to="/cover-letters/new"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M12 4v16m8-8H4" />
          </svg>
          Generate New Letter
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="search" className="sr-only">
            Search cover letters
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              id="search"
              className="block w-full rounded-md border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Search by title, company, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <label htmlFor="status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="status-filter"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'draft' | 'finalized' | '')}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">Failed to load cover letters. Please try again.</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
        </div>
      ) : coverLetters.length === 0 ? (
        <EmptyState
          variant="no-documents"
          actionLabel="Generate New Letter"
          onAction={() => navigate('/cover-letters/new')}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coverLetters.map((letter) => (
            <li key={letter.id}>
              <Link
                to={`/cover-letters/${letter.id}`}
                className="block h-full rounded-lg border border-gray-200 p-4 shadow-sm transition-all hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-neutral-900">{letter.title}</h2>
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[letter.status]}`}
                  >
                    {letter.status === 'draft' ? 'Draft' : 'Finalized'}
                  </span>
                </div>
                <p className="mb-2 text-sm text-neutral-600">
                  {letter.targetRole} at {letter.targetCompany}
                </p>
                <p className="mb-3 line-clamp-3 text-xs text-neutral-500">{letter.preview}</p>
                <p className="text-xs text-neutral-400">
                  {formatDistanceToNow(new Date(letter.createdAt), { addSuffix: true })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
