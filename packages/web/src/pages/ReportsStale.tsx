import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReportsStale } from '../hooks/useReports';
import { StatusBadge } from '../components/StatusBadge';
import type { ApplicationStatus } from '../types/application';

export function ReportsStale() {
  const navigate = useNavigate();
  const [staleThreshold, setStaleThreshold] = useState(14);

  const { data, isLoading } = useReportsStale({ days: staleThreshold });

  const applications = data?.applications ?? [];
  const summary = data?.summary ?? { total: 0, byStatus: {}, averageDaysStale: 0 };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading stale applications report...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">Stale Applications</h1>
          <p className="mt-2 text-neutral-600">
            Applications that haven't been updated recently
          </p>
        </div>
        <div>
          <label htmlFor="staleThreshold" className="mr-2 text-sm font-medium text-neutral-700">
            Stale threshold:
          </label>
          <select
            id="staleThreshold"
            value={staleThreshold}
            onChange={(e) => setStaleThreshold(Number(e.target.value))}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={21}>21 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-900">{summary.total}</div>
          <div className="text-sm text-neutral-600">Total Stale</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-yellow-600">
            {summary.byStatus['applied'] ?? 0}
          </div>
          <div className="text-sm text-neutral-600">Applied</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-orange-600">
            {summary.byStatus['phone_screen'] ?? 0}
          </div>
          <div className="text-sm text-neutral-600">Phone Screen</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-600">{summary.averageDaysStale}</div>
          <div className="text-sm text-neutral-600">Avg Days</div>
        </div>
      </div>

      {/* Stale Applications List */}
      {applications.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="text-lg font-semibold text-neutral-900">No stale applications found</h3>
          <p className="mt-2 text-sm text-neutral-600">
            All your applications have been updated within {staleThreshold} days. Your pipeline is
            active!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <div
              key={app.id}
              className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              onClick={() => navigate(`/applications/${app.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
                      ⏱️ {app.daysSinceUpdate} days since last update
                    </span>
                    <StatusBadge status={app.status as ApplicationStatus} />
                  </div>
                  <h3 className="text-lg font-semibold text-neutral-900">
                    {app.jobTitle} @ {app.company}
                  </h3>
                  {app.contact && (
                    <p className="mt-1 text-sm text-neutral-600">
                      <span className="font-medium">Contact:</span> {app.contact}
                    </p>
                  )}
                  {app.url && (
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center text-sm text-primary-600 hover:text-primary-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View job posting
                      <svg
                        className="ml-1 h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  )}
                </div>
                <div className="ml-4">
                  <div className="text-sm text-neutral-500">
                    Last updated: {new Date(app.updatedAt).toLocaleDateString()}
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    <button
                      className="rounded-md bg-primary-600 px-3 py-1 text-sm font-medium text-white hover:bg-primary-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/applications/${app.id}`);
                      }}
                    >
                      Set Next Action
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <p className="mt-4 text-xs text-neutral-400">
          Report generated at {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
