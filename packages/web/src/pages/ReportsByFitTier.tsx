import { useNavigate } from 'react-router-dom';
import { useReportsByFitTier } from '../hooks/useReports';

export function ReportsByFitTier() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useReportsByFitTier();

  const summary = data?.summary ?? { total: 0, analyzed: 0, notAnalyzed: 0, byTier: {} };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading by fit tier report...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800 font-medium">Failed to load fit tier report</p>
          <p className="mt-2 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Please try refreshing the page.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900">By Fit Tier</h1>
        <p className="mt-2 text-neutral-600">Priority grouping by job fit analysis score</p>
      </div>

      {/* UC-3 Dependency Notice */}
      <div className="rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-8">
        <div className="text-center">
          <div className="text-4xl mb-4">🎯</div>
          <h2 className="text-xl font-semibold text-neutral-900 mb-2">Job Fit Analysis Required</h2>
          <p className="text-neutral-600 mb-6 max-w-2xl mx-auto">
            This report groups applications by fit tier (Strong, Moderate, Weak). To use this
            feature, you need to run job fit analysis on your applications first.
          </p>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            View Applications
            <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Not Analyzed count from API */}
      <div className="mt-8">
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">Not Analyzed</h3>
              <p className="mt-1 text-sm text-neutral-600">Applications without fit analysis</p>
            </div>
            <div className="text-3xl font-bold text-neutral-900">{summary.notAnalyzed}</div>
          </div>
        </div>
      </div>

      {/* Placeholder tier groups */}
      <div className="mt-6 grid gap-4 md:grid-cols-3 opacity-50">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-green-900">Strong Fit</h3>
              <p className="mt-1 text-sm text-green-700">High match score</p>
            </div>
            <div className="text-3xl font-bold text-green-900">
              {summary.byTier['strong_fit'] ?? '—'}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-yellow-900">Moderate Fit</h3>
              <p className="mt-1 text-sm text-yellow-700">Medium match score</p>
            </div>
            <div className="text-3xl font-bold text-yellow-900">
              {summary.byTier['moderate_fit'] ?? '—'}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">Weak Fit</h3>
              <p className="mt-1 text-sm text-neutral-700">Low match score</p>
            </div>
            <div className="text-3xl font-bold text-neutral-900">
              {summary.byTier['weak_fit'] ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {data && (
        <p className="mt-4 text-xs text-neutral-400">
          Report generated at {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
