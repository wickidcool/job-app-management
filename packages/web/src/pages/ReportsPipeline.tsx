import { useNavigate } from 'react-router-dom';
import { useReportsPipeline } from '../hooks/useReports';
import type { PipelineApplication, ActiveStatus } from '../services/api';

const STATUS_LABELS: Record<ActiveStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  phone_screen: 'Phone Screen',
  interview: 'Interview',
};

const STATUS_COLORS: Record<ActiveStatus, string> = {
  saved: 'border-blue-200 bg-blue-50',
  applied: 'border-yellow-200 bg-yellow-50',
  phone_screen: 'border-orange-200 bg-orange-50',
  interview: 'border-purple-200 bg-purple-50',
};

const STATUS_HEADER_COLORS: Record<ActiveStatus, string> = {
  saved: 'bg-blue-100 text-blue-800',
  applied: 'bg-yellow-100 text-yellow-800',
  phone_screen: 'bg-orange-100 text-orange-800',
  interview: 'bg-purple-100 text-purple-800',
};

function isDueSoon(nextActionDue: string | null | undefined): boolean {
  if (!nextActionDue) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextActionDue);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays <= 3;
}

function isOverdue(nextActionDue: string | null | undefined): boolean {
  if (!nextActionDue) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(nextActionDue) < today;
}

function isStale(updatedAt: string): boolean {
  const updated = new Date(updatedAt);
  const daysSince = Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24));
  return daysSince >= 14;
}

function PipelineCard({
  app,
  onClick,
}: {
  app: PipelineApplication;
  onClick: () => void;
}) {
  const overdue = isOverdue(app.nextActionDue);
  const dueSoon = !overdue && isDueSoon(app.nextActionDue);
  const stale = isStale(app.updatedAt);

  return (
    <div
      className="cursor-pointer rounded-md border border-neutral-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <h4 className="text-sm font-semibold text-neutral-900 truncate">{app.jobTitle}</h4>
      <p className="mt-0.5 text-xs text-neutral-600 truncate">{app.company}</p>
      {app.location && (
        <p className="mt-0.5 text-xs text-neutral-500 truncate">{app.location}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {overdue && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            🔴 Overdue
          </span>
        )}
        {dueSoon && (
          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
            🟡 Due soon
          </span>
        )}
        {stale && (
          <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
            ⏱️ Stale
          </span>
        )}
      </div>
      {app.nextAction && (
        <p className="mt-1 text-xs text-neutral-600 truncate">
          <span className="font-medium">Next:</span> {app.nextAction}
        </p>
      )}
    </div>
  );
}

export function ReportsPipeline() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useReportsPipeline();

  const computeStats = () => {
    if (!data) return { overdue: 0, dueToday: 0, dueSoon: 0, stale: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let overdue = 0;
    let dueToday = 0;
    let dueSoon = 0;
    let stale = 0;

    for (const group of data.groups) {
      for (const app of group.applications) {
        if (app.nextActionDue) {
          const due = new Date(app.nextActionDue);
          due.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) overdue++;
          else if (diffDays === 0) dueToday++;
          else if (diffDays <= 7) dueSoon++;
        }
        const daysSince = Math.floor(
          (Date.now() - new Date(app.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSince >= 14) stale++;
      }
    }

    return { overdue, dueToday, dueSoon, stale };
  };

  const stats = computeStats();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading pipeline report...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800 font-medium">Failed to load pipeline report</p>
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
        <h1 className="text-3xl font-bold text-neutral-900">Pipeline Report</h1>
        <p className="mt-2 text-neutral-600">
          Active applications grouped by status with due date and staleness indicators
        </p>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-900">{data?.totals.active ?? 0}</div>
          <div className="text-sm text-neutral-600">Active Apps</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
          <div className="text-sm text-neutral-600">Overdue</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-orange-600">{stats.dueToday}</div>
          <div className="text-sm text-neutral-600">Due Today</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-yellow-600">{stats.dueSoon}</div>
          <div className="text-sm text-neutral-600">Due Soon</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-600">{stats.stale}</div>
          <div className="text-sm text-neutral-600">Stale (14+ days)</div>
        </div>
      </div>

      {/* Grouped Columns */}
      {!data || data.totals.active === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <p className="text-neutral-600">No active applications in the pipeline.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {data.groups.map((group) => (
            <div key={group.status} className={`rounded-lg border-2 p-4 ${STATUS_COLORS[group.status]}`}>
              <div className="mb-3 flex items-center justify-between">
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${STATUS_HEADER_COLORS[group.status]}`}>
                  {STATUS_LABELS[group.status]}
                </span>
                <span className="text-sm font-medium text-neutral-600">{group.count}</span>
              </div>
              <div className="space-y-2">
                {group.applications.map((app) => (
                  <PipelineCard
                    key={app.id}
                    app={app}
                    onClick={() => navigate(`/applications/${app.id}`)}
                  />
                ))}
                {group.applications.length === 0 && (
                  <p className="py-4 text-center text-xs text-neutral-500">No applications</p>
                )}
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
