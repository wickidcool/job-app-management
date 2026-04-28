import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReportsNeedsAction } from '../hooks/useReports';
import { StatusBadge } from '../components/StatusBadge';
import type { UrgencyLevel, NeedsActionApplication } from '../services/api';

function urgencyBadgeColor(urgency: UrgencyLevel): string {
  switch (urgency) {
    case 'overdue':
      return 'bg-red-100 text-red-800';
    case 'due_soon':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-neutral-100 text-neutral-800';
  }
}

function urgencyIcon(urgency: UrgencyLevel): string {
  switch (urgency) {
    case 'overdue':
      return '🔴';
    case 'due_soon':
      return '🟡';
    default:
      return '';
  }
}

function dueDateLabel(item: NeedsActionApplication): string {
  if (item.daysUntilDue < 0) {
    const days = Math.abs(item.daysUntilDue);
    return `${days} day${days !== 1 ? 's' : ''} overdue`;
  } else if (item.daysUntilDue === 0) {
    return 'Due today';
  } else if (item.daysUntilDue === 1) {
    return 'Due tomorrow';
  } else {
    return `Due in ${item.daysUntilDue} days`;
  }
}

export function ReportsNeedsAction() {
  const navigate = useNavigate();
  const [daysThreshold, setDaysThreshold] = useState(7);

  const { data, isLoading, isError, error } = useReportsNeedsAction({ days: daysThreshold });

  const applications = data?.applications ?? [];
  const summary = data?.summary ?? { overdue: 0, dueSoon: 0, upcoming: 0, total: 0 };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading needs action report...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800 font-medium">Failed to load needs action report</p>
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
          <h1 className="text-3xl font-bold text-neutral-900">Needs Action</h1>
          <p className="mt-2 text-neutral-600">
            Applications with upcoming or overdue action items
          </p>
        </div>
        <div>
          <label htmlFor="daysThreshold" className="mr-2 text-sm font-medium text-neutral-700">
            Show items due within:
          </label>
          <select
            id="daysThreshold"
            value={daysThreshold}
            onChange={(e) => setDaysThreshold(Number(e.target.value))}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-red-600">{summary.overdue}</div>
          <div className="text-sm text-neutral-600">Overdue</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-yellow-600">{summary.dueSoon}</div>
          <div className="text-sm text-neutral-600">Due Soon</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-600">{summary.upcoming}</div>
          <div className="text-sm text-neutral-600">Upcoming</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-600">{summary.total}</div>
          <div className="text-sm text-neutral-600">Total</div>
        </div>
      </div>

      {/* Items List */}
      {applications.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h3 className="text-lg font-semibold text-neutral-900">
            No actions due within {daysThreshold} days
          </h3>
          <p className="mt-2 text-sm text-neutral-600">Great work staying on top of things!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((item) => (
            <div
              key={item.id}
              className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              onClick={() => navigate(`/applications/${item.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${urgencyBadgeColor(item.urgency)}`}
                    >
                      {urgencyIcon(item.urgency)} {dueDateLabel(item)}
                    </span>
                    <StatusBadge status={item.status as Parameters<typeof StatusBadge>[0]['status']} />
                  </div>
                  <h3 className="text-lg font-semibold text-neutral-900">
                    {item.jobTitle} @ {item.company}
                  </h3>
                  <p className="mt-1 text-sm text-neutral-700">
                    <span className="font-medium">Next Action:</span> {item.nextAction}
                  </p>
                  {item.contact && (
                    <p className="mt-1 text-sm text-neutral-600">
                      <span className="font-medium">Contact:</span> {item.contact}
                    </p>
                  )}
                </div>
                <div className="ml-4 text-sm text-neutral-500">
                  Updated {new Date(item.updatedAt).toLocaleDateString()}
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
