import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReportsStale } from '../hooks/useReports';
import { StatusBadge } from '../components/StatusBadge';
import type { ApplicationStatus } from '../types/application';
import { DEFAULT_STALE_THRESHOLD_DAYS, STALE_THRESHOLD_OPTIONS } from '../constants/stale';

/**
 * The page shell, carrying this route's top-level heading (WIC-2050).
 *
 * **Every branch renders it.** The loading and error states below used to return before
 * the header block, so they came back with no heading at all — the route opened at
 * nothing, which is the WCAG 2.1 AA (SC 1.3.1) defect `routeOutline.render.test.tsx`
 * inventories. Putting the heading above the early returns rather than beside the loaded
 * content is what makes those two branches conform. `CoverLetterNew` is the pattern.
 *
 * `actions` is a slot rather than a fixed child because the threshold control filters the
 * loaded report and has nothing to act on while the request is in flight or failed.
 */
function ReportsStaleLayout({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">Stale Applications</h1>
          <p className="mt-2 text-neutral-600">Applications that haven't been updated recently</p>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function ReportsStale() {
  const navigate = useNavigate();
  // Not a literal: the dashboard links here promising a count computed at the
  // server's default window, so the report has to open on that same window or
  // the two disagree on arrival (WIC-1479 AC-N2b).
  const [staleThreshold, setStaleThreshold] = useState<number>(DEFAULT_STALE_THRESHOLD_DAYS);

  const { data, isLoading, isError, error } = useReportsStale({ days: staleThreshold });

  const applications = data?.applications ?? [];
  const summary = data?.summary ?? { total: 0, byStatus: {}, averageDaysStale: 0 };

  if (isLoading) {
    return (
      <ReportsStaleLayout>
        <div className="text-center">Loading stale applications report...</div>
      </ReportsStaleLayout>
    );
  }

  if (isError) {
    return (
      <ReportsStaleLayout>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800 font-medium">Failed to load stale applications report</p>
          <p className="mt-2 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Please try refreshing the page.'}
          </p>
        </div>
      </ReportsStaleLayout>
    );
  }

  return (
    <ReportsStaleLayout
      actions={
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
            {STALE_THRESHOLD_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>
      }
    >
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
          <h2 className="text-lg font-semibold text-neutral-900">No stale applications found</h2>
          <p className="mt-2 text-sm text-neutral-600">
            All your applications have been updated within {staleThreshold} days. Your pipeline is
            active!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            // Navigation hangs off a real <button> inside the heading below, not off
            // this <div> (WIC-2062) — see the note on `ClosedAppCard` in
            // ReportsClosedLoop.tsx for why `role="button"` here is not the fix.
            //
            // This card is the one that had nested interactives: the "View job posting"
            // link and the "Set Next Action" button both carried `stopPropagation` for
            // the sole purpose of escaping the wrapper's handler. With the wrapper inert
            // there is nothing to escape, so both are deleted. Removing the workaround
            // rather than adding one is the tell that this shape is right.
            <div
              key={app.id}
              className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
                      ⏱️ {app.daysSinceUpdate} days since last update
                    </span>
                    <StatusBadge status={app.status as ApplicationStatus} />
                  </div>
                  <h2 className="text-lg font-semibold text-neutral-900">
                    <button
                      type="button"
                      onClick={() => navigate(`/applications/${app.id}`)}
                      className="w-full rounded text-left hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      {app.jobTitle} @ {app.company}
                    </button>
                  </h2>
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
                      type="button"
                      className="rounded-md bg-primary-600 px-3 py-1 text-sm font-medium text-white hover:bg-primary-700"
                      onClick={() => navigate(`/applications/${app.id}`)}
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
    </ReportsStaleLayout>
  );
}
