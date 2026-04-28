import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeVariantCard } from '../components/ResumeVariantCard';
import { EmptyState } from '../components/EmptyState';
import { useResumeVariants, useDeleteResumeVariant } from '../hooks/useResumeVariants';
import type { ResumeFormat } from '../services/api/types';

export function ResumeVariantsList() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'draft' | 'finalized' | ''>('');
  const [formatFilter, setFormatFilter] = useState<ResumeFormat | ''>('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error } = useResumeVariants({
    status: statusFilter || undefined,
    format: formatFilter || undefined,
    search: searchQuery || undefined,
  });

  const deleteVariant = useDeleteResumeVariant();

  const handleDelete = (id: string) => {
    deleteVariant.mutate(id, {
      onError: (error) => {
        console.error('Failed to delete variant:', error);
        alert('Failed to delete resume variant. Please try again.');
      },
    });
  };

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Variants' },
  ];

  const variants = data?.variants || [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-neutral-900">Resume Variants</h1>
        <button
          onClick={() => navigate('/resume-variants/new')}
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
          >
            <path d="M12 4v16m8-8H4" />
          </svg>
          Generate New Variant
        </button>
      </div>

      <div className="mb-6 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="search" className="sr-only">
            Search
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
              >
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              id="search"
              className="block w-full rounded-md border border-gray-300 pl-10 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Search by title, company, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'draft' | 'finalized' | '')}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
          </select>

          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value as ResumeFormat | '')}
          >
            <option value="">All Formats</option>
            <option value="chronological">Chronological</option>
            <option value="functional">Functional</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">Failed to load resume variants. Please try again.</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
        </div>
      ) : variants.length === 0 ? (
        <EmptyState
          variant="no-documents"
          actionLabel="Generate New Variant"
          onAction={() => navigate('/resume-variants/new')}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {variants.map((variant) => (
            <ResumeVariantCard
              key={variant.id}
              variant={variant}
              onCardClick={(id) => navigate(`/resume-variants/${id}`)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
