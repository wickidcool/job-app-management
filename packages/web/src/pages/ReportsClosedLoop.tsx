import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApplications } from '../hooks/useApplications';
import { StatusBadge } from '../components/StatusBadge';
import type { Application } from '../types/application';

type Period = '30d' | '60d' | '90d' | 'all';

export function ReportsClosedLoop() {
  const navigate = useNavigate();
  const { data: applications = [], isLoading } = useApplications();
  const [period, setPeriod] = useState<Period>('all');

  const filterByPeriod = (apps: Application[]): Application[] => {
    if (period === 'all') return apps;

    const today = new Date();
    const cutoffDate = new Date(today);

    switch (period) {
      case '30d':
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        break;
      case '60d':
        cutoffDate.setDate(cutoffDate.getDate() - 60);
        break;
      case '90d':
        cutoffDate.setDate(cutoffDate.getDate() - 90);
        break;
    }

    return apps.filter((app) => new Date(app.updatedAt) >= cutoffDate);
  };

  const closedApplications = filterByPeriod(
    applications.filter((app) => ['rejected', 'offer', 'withdrawn'].includes(app.status))
  );

  const offers = closedApplications.filter((app) => app.status === 'offer');
  const rejections = closedApplications.filter((app) => app.status === 'rejected');
  const withdrawn = closedApplications.filter((app) => app.status === 'withdrawn');

  const stats = {
    total: closedApplications.length,
    offers: offers.length,
    rejections: rejections.length,
    withdrawn: withdrawn.length,
    conversionRate:
      closedApplications.length > 0
        ? Math.round((offers.length / closedApplications.length) * 100)
        : 0,
    avgTimeToClose:
      closedApplications.length > 0
        ? Math.round(
            closedApplications.reduce((sum, app) => {
              const created = new Date(app.createdAt).getTime();
              const closed = new Date(app.updatedAt).getTime();
              return sum + (closed - created) / (1000 * 60 * 60 * 24);
            }, 0) / closedApplications.length
          )
        : 0,
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading closed loop analysis...</div>
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
          <div className="text-2xl font-bold text-neutral-900">{stats.total}</div>
          <div className="text-sm text-neutral-600">Total Closed</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-green-600">{stats.offers}</div>
          <div className="text-sm text-neutral-600">Offers</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-red-600">{stats.rejections}</div>
          <div className="text-sm text-neutral-600">Rejections</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-primary-600">{stats.conversionRate}%</div>
          <div className="text-sm text-neutral-600">Offer Rate</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-600">{stats.avgTimeToClose}</div>
          <div className="text-sm text-neutral-600">Avg Days to Close</div>
        </div>
      </div>

      {closedApplications.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-lg font-semibold text-neutral-900">No closed applications yet</h3>
          <p className="mt-2 text-sm text-neutral-600">
            As you receive offers or rejections, they'll appear here for analysis.
          </p>
        </div>
      ) : (
        <>
          {/* Offers Section */}
          {offers.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-4 text-xl font-semibold text-neutral-900 flex items-center gap-2">
                <span className="text-2xl">🎉</span>
                Offers ({offers.length})
              </h2>
              <div className="space-y-3">
                {offers.map((app) => (
                  <div
                    key={app.id}
                    className="cursor-pointer rounded-lg border border-green-200 bg-green-50 p-4 transition-shadow hover:shadow-md"
                    onClick={() => navigate(`/applications/${app.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-neutral-900">
                          {app.jobTitle} @ {app.company}
                        </h3>
                        {app.salaryRange && (
                          <p className="mt-1 text-sm text-neutral-700">
                            <span className="font-medium">Posted Range:</span> {app.salaryRange}
                          </p>
                        )}
                        {app.compTarget && (
                          <p className="mt-1 text-sm text-neutral-700">
                            <span className="font-medium">Your Target:</span> {app.compTarget}
                          </p>
                        )}
                      </div>
                      <div className="ml-4 text-sm text-neutral-500">
                        {new Date(app.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
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
                {rejections.map((app) => {
                  const daysToClosure = Math.floor(
                    (new Date(app.updatedAt).getTime() - new Date(app.createdAt).getTime()) /
                      (1000 * 60 * 60 * 24)
                  );

                  return (
                    <div
                      key={app.id}
                      className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-md"
                      onClick={() => navigate(`/applications/${app.id}`)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-lg font-semibold text-neutral-900">
                              {app.jobTitle} @ {app.company}
                            </h3>
                          </div>
                          {app.location && (
                            <p className="text-sm text-neutral-600">{app.location}</p>
                          )}
                          <p className="mt-1 text-sm text-neutral-500">
                            {daysToClosure} days in pipeline
                          </p>
                        </div>
                        <div className="ml-4 text-sm text-neutral-500">
                          {new Date(app.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                  <div
                    key={app.id}
                    className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-md"
                    onClick={() => navigate(`/applications/${app.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-neutral-900">
                          {app.jobTitle} @ {app.company}
                        </h3>
                      </div>
                      <div className="ml-4 text-sm text-neutral-500">
                        {new Date(app.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
