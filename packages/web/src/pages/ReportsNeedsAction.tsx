import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApplications } from '../hooks/useApplications';
import { StatusBadge } from '../components/StatusBadge';
import type { Application } from '../types/application';

type UrgencyLevel = 'overdue' | 'today' | 'soon' | 'later';

interface NeedsActionItem extends Application {
  urgency: UrgencyLevel;
  daysUntilDue: number;
}

export function ReportsNeedsAction() {
  const navigate = useNavigate();
  const { data: applications = [], isLoading } = useApplications();
  const [daysThreshold, setDaysThreshold] = useState(7);

  const calculateNeedsActionItems = (): NeedsActionItem[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thresholdDate = new Date(today);
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    return applications
      .filter(
        (app) =>
          app.nextActionDue &&
          !['offer', 'rejected', 'withdrawn'].includes(app.status)
      )
      .map((app) => {
        const dueDate = new Date(app.nextActionDue!);
        dueDate.setHours(0, 0, 0, 0);
        const daysUntilDue = Math.ceil(
          (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        let urgency: UrgencyLevel;
        if (daysUntilDue < 0) {
          urgency = 'overdue';
        } else if (daysUntilDue === 0) {
          urgency = 'today';
        } else if (daysUntilDue <= 3) {
          urgency = 'soon';
        } else {
          urgency = 'later';
        }

        return {
          ...app,
          urgency,
          daysUntilDue,
        };
      })
      .filter((item) => item.daysUntilDue <= daysThreshold)
      .sort((a, b) => {
        // Sort overdue first (by most overdue), then by due date ascending
        if (a.daysUntilDue < 0 && b.daysUntilDue < 0) {
          return a.daysUntilDue - b.daysUntilDue;
        }
        if (a.daysUntilDue < 0) return -1;
        if (b.daysUntilDue < 0) return 1;
        return a.daysUntilDue - b.daysUntilDue;
      });
  };

  const needsActionItems = calculateNeedsActionItems();

  const groupedItems = {
    overdue: needsActionItems.filter((item) => item.urgency === 'overdue'),
    today: needsActionItems.filter((item) => item.urgency === 'today'),
    soon: needsActionItems.filter((item) => item.urgency === 'soon'),
    later: needsActionItems.filter((item) => item.urgency === 'later'),
  };

  const getUrgencyBadgeColor = (urgency: UrgencyLevel) => {
    switch (urgency) {
      case 'overdue':
        return 'bg-red-100 text-red-800';
      case 'today':
        return 'bg-orange-100 text-orange-800';
      case 'soon':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-neutral-100 text-neutral-800';
    }
  };

  const formatDueDate = (item: NeedsActionItem) => {
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
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading needs action report...</div>
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
          <div className="text-2xl font-bold text-red-600">{groupedItems.overdue.length}</div>
          <div className="text-sm text-neutral-600">Overdue</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-orange-600">{groupedItems.today.length}</div>
          <div className="text-sm text-neutral-600">Due Today</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-yellow-600">{groupedItems.soon.length}</div>
          <div className="text-sm text-neutral-600">Due Soon</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-600">{needsActionItems.length}</div>
          <div className="text-sm text-neutral-600">Total</div>
        </div>
      </div>

      {/* Items List */}
      {needsActionItems.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h3 className="text-lg font-semibold text-neutral-900">
            No actions due within {daysThreshold} days
          </h3>
          <p className="mt-2 text-sm text-neutral-600">Great work staying on top of things!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {needsActionItems.map((item) => (
            <div
              key={item.id}
              className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              onClick={() => navigate(`/applications/${item.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getUrgencyBadgeColor(item.urgency)}`}>
                      {item.urgency === 'overdue' && '🔴'}
                      {item.urgency === 'today' && '🟠'}
                      {item.urgency === 'soon' && '🟡'}
                      {formatDueDate(item)}
                    </span>
                    <StatusBadge status={item.status} />
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
    </div>
  );
}
