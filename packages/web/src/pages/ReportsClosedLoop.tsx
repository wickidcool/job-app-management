import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReportsClosedLoop } from '../hooks/useReports';
import type { ClosedLoopApplication } from '../services/api';

type Period = '30d' | '60d' | '90d' | 'all';

const STATUS_LABELS: Record<string, string> = {
  saved: 'Saved',
  applied: 'Applied',
  phone_screen: 'Phone Screen',
  interview: 'Interview',
};

function ClosedAppCard({
  app,
  onClick,
}: {
  app: ClosedLoopApplication;
  onClick: () => void;
}) {
  const borderColor =
    app.status === 'offer'
      ? 'border-green-200 bg-green-50'
      : app.status === 'withdrawn'
        ? 'border-neutral-200 bg-white'
        : 'border-neutral-200 bg-white';

  return (
    <div
      className={`cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-md ${borderColor}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-neutral-900">
            {app.jobTitle} @ {app.company}
          </h3>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600">
            <span>{app.daysInPipeline} days in pipeline</span>
            {app.previousStatus && (
              <span>
                Rejected from:{' '}
                <span className="font-medium">
                  {STATUS_LABELS[app.previousStatus] ?? app.previousStatus}
                </span>
              </span>
            )}
          </div>
          {app.status === 'offer' && (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-700">
              {app.salaryRange && (
                <span>
                  <span className="font-medium">Posted Range:</span> {app.salaryRange}
                </span>
              )}
              {app.compTarget && (
                <span>
                  <span className="font-medium">Your Target:</span> {app.compTarget}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="ml-4 text-sm text-neutral-500">
          {new Date(app.closedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

export function ReportsClosedLoop() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('all');

  const { data, isLoading, isError, error } = useReportsClosedLoop({ period });

  const applications = data?.applications ?? [];
  const summary = data?.summary ?? {
    total: 0,
    offers: 0,
    rejections: 0,
    withdrawn: 0,
    rejectionsByStage: [],
    averageTimeToClose: 0,
  };

  const offers = applications.filter((a) => a.status === 'offer');
  const rejections = applications.filter((a) => a.status === 'rejected');
  const withdrawn = applications.filter((a) => a.status === 'withdrawn');
  const conversionRate =
    summary.total > 0 ? Math.round((summary.offers / summary.total) * 100) : 0;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading closed loop analysis...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800 font-medium">Failed to load closed loop analysis</p>
          <p className="mt-2 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Please try refreshing the page.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">Closed Loop Analysis</h1>
          <p className="mt-2 text-neutral-600">Analyze outcomes to identify patterns and improve</p>
        </div>
        <div>
          <label htmlFor="period" className="mr-2 text-sm font-medium text-neutral-700">
            Time period:
          </label>
          <select
            id="period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="30d">Last 30 days</option>
            <option value="60d">Last 60 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-900">{summary.total}</div>
          <div className="text-sm text-neutral-600">Total Closed</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-green-600">{summary.offers}</div>
          <div className="text-sm text-neutral-600">Offers</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-red-600">{summary.rejections}</div>
          <div className="text-sm text-neutral-600">Rejections</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-primary-600">{conversionRate}%</div>
          <div className="text-sm text-neutral-600">Offer Rate</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-600">{summary.averageTimeToClose}</div>
          <div className="text-sm text-neutral-600">Avg Days to Close</div>
        </div>
      </div>

      {applications.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-lg font-semibold text-neutral-900">No closed applications yet</h3>
          <p className="mt-2 text-sm text-neutral-600">
            As you receive offers or rejections, they'll appear here for analysis.
          </p>
        </div>
      ) : (
        <>
          {/* Rejection by Stage Breakdown */}
          {summary.rejectionsByStage.length > 0 && (
            <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-6">
              <h2 className="mb-4 text-lg font-semibold text-neutral-900">
                Rejections by Stage
              </h2>
              <div className="space-y-2">
                {summary.rejectionsByStage.map(({ stage, count, percentage }) => (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="w-32 text-sm text-neutral-700">
                      {STATUS_LABELS[stage] ?? stage}
                    </span>
                    <div className="flex-1 rounded-full bg-neutral-100 h-3">
                      <div
                        className="rounded-full bg-red-400 h-3"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="w-16 text-sm text-neutral-600 text-right">
                      {count} ({percentage}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Offers Section */}
          {offers.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-4 text-xl font-semibold text-neutral-900 flex items-center gap-2">
                <span className="text-2xl">🎉</span>
                Offers ({offers.length})
              </h2>
              <div className="space-y-3">
                {offers.map((app) => (
                  <ClosedAppCard
                    key={app.id}
                    app={app}
                    onClick={() => navigate(`/applications/${app.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Rejections Section */}
          {rejections.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-4 text-xl font-semibold text-neutral-900 flex items-center gap-2">
                <span className="text-2xl">❌</span>
                Rejections ({rejections.length})
              </h2>
              <div className="space-y-3">
                {rejections.map((app) => (
                  <ClosedAppCard
                    key={app.id}
                    app={app}
                    onClick={() => navigate(`/applications/${app.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Withdrawn Section */}
          {withdrawn.length > 0 && (
            <div>
              <h2 className="mb-4 text-xl font-semibold text-neutral-900 flex items-center gap-2">
                <span className="text-2xl">🚫</span>
                Withdrawn ({withdrawn.length})
              </h2>
              <div className="space-y-3">
                {withdrawn.map((app) => (
                  <ClosedAppCard
                    key={app.id}
                    app={app}
                    onClick={() => navigate(`/applications/${app.id}`)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {data && (
        <p className="mt-4 text-xs text-neutral-400">
          Report generated at {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
