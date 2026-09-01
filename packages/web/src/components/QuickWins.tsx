import { Link } from 'react-router-dom';
import { differenceInDays } from 'date-fns';
import type { DashboardAttention } from '../services/api/types';

/** How many action rows the card renders before collapsing the rest into a link. */
const VISIBLE_WIN_LIMIT = 5;

interface QuickWinsProps {
  /**
   * Server-computed aggregates over *every* application: full-table counts plus
   * short top-N sample rows.
   *
   * Deriving these on the client is not possible correctly — `GET /api/applications`
   * returns a page ordered by most-recently updated, so a client-side scan for
   * the *least* recently updated rows is blind to every row it should find.
   */
  attention?: DashboardAttention;
}

/**
 * The age of a sampled row, reported so it cannot contradict the bucket the
 * server selected the row into.
 *
 * The server picks these rows with `timestamp < now - thresholdDays` — a
 * *fractional* age strictly greater than the threshold. `differenceInDays`
 * floors, so a row selected at 7.5 days reads back as 7, and rendering that
 * number puts "7 days" beside an `AttentionCard` advertising a ">7 days"
 * bucket. Below the threshold the floor has not yet cleared it and the only
 * honest statement is the bound the selection itself proves; above it the
 * exact count is both true and more useful.
 *
 * `thresholdDays` is undefined only if the wire payload omitted it, in which
 * case there is no bucket claim on screen for the count to contradict.
 */
function sampledAge(timestamp: string, thresholdDays: number | undefined) {
  const flooredDays = differenceInDays(new Date(), new Date(timestamp));

  if (thresholdDays === undefined || flooredDays > thresholdDays) {
    return { days: flooredDays, exact: true };
  }

  return { days: thresholdDays, exact: false };
}

interface QuickWin {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action: string;
  actionPath: string;
  applicationId?: string;
}

export function QuickWins({ attention }: QuickWinsProps) {
  const quickWins: QuickWin[] = [];
  const samples = attention?.samples;
  const counts = attention?.counts;

  // High Priority: Interviews in progress.
  // (We don't track interview dates yet, so every interview-stage application counts.)
  (samples?.interviewing ?? []).forEach((app) => {
    quickWins.push({
      id: `interview-${app.id}`,
      priority: 'high',
      title: 'Prepare for Interview',
      description: `${app.company} - ${app.jobTitle}`,
      action: 'Start Prep',
      actionPath: `/applications/${app.id}/prep`,
      applicationId: app.id,
    });
  });

  // High Priority: Stale applications in active stages (oldest first)
  (samples?.staleActive ?? []).forEach((app) => {
    const age = sampledAge(app.updatedAt, attention?.staleThresholdDays);
    quickWins.push({
      id: `stale-${app.id}`,
      priority: 'high',
      title: 'Follow Up Needed',
      description: age.exact
        ? `${app.company} - No update for ${age.days} days`
        : `${app.company} - No update in over ${age.days} days`,
      action: 'Send Follow-up',
      actionPath: `/applications/${app.id}`,
      applicationId: app.id,
    });
  });

  // Medium Priority: Applications missing job description (can't do fit analysis)
  (samples?.missingJobDescription ?? []).forEach((app) => {
    quickWins.push({
      id: `missing-desc-${app.id}`,
      priority: 'medium',
      title: 'Add Job Description',
      description: `${app.company} - ${app.jobTitle}`,
      action: 'Update',
      actionPath: `/applications/${app.id}`,
      applicationId: app.id,
    });
  });

  // Medium Priority: Saved applications not yet applied (longest-saved first)
  (samples?.staleSaved ?? []).forEach((app) => {
    const age = sampledAge(app.createdAt, attention?.savedThresholdDays);
    quickWins.push({
      id: `saved-${app.id}`,
      priority: 'medium',
      title: 'Complete Application',
      description: age.exact
        ? `${app.company} - Saved ${age.days} days ago`
        : `${app.company} - Saved over ${age.days} days ago`,
      action: 'Apply Now',
      actionPath: `/applications/${app.id}`,
      applicationId: app.id,
    });
  });

  // Sort by priority (high > medium > low) and limit to the visible window
  const sortedWins = quickWins
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, VISIBLE_WIN_LIMIT);

  // Total actionable items across the whole account, not just the sampled rows.
  // The samples are capped for rendering; these counts are not.
  const totalWins = counts
    ? counts.interviewing + counts.staleActive + counts.missingJobDescription + counts.staleSaved
    : quickWins.length;
  const hiddenWins = Math.max(0, totalWins - sortedWins.length);

  const getPriorityColor = (priority: QuickWin['priority']) => {
    switch (priority) {
      case 'high':
        return 'border-error-200 bg-error-50';
      case 'medium':
        return 'border-warning-200 bg-warning-50';
      case 'low':
        return 'border-info-200 bg-info-50';
    }
  };

  const getPriorityIcon = (priority: QuickWin['priority']) => {
    switch (priority) {
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      case 'low':
        return '🔵';
    }
  };

  if (sortedWins.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <h2 className="text-lg font-semibold text-neutral-900">Quick Wins</h2>
        </div>
        {/*
          Only claim "all caught up" once the aggregates have arrived. Before
          then we know nothing about the account, and an empty list is not
          evidence that there is nothing to do.
        */}
        {attention ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="mb-3 text-4xl">🎉</span>
            <p className="text-sm font-medium text-success-700">All caught up!</p>
            <p className="mt-1 text-xs text-neutral-500">No urgent actions needed right now</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-neutral-500">Checking your applications…</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <h2 className="text-lg font-semibold text-neutral-900">Quick Wins</h2>
        </div>
        <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
          {totalWins} action{totalWins !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {sortedWins.map((win) => (
          <div
            key={win.id}
            className={`rounded-lg border p-3 transition-all hover:shadow-sm ${getPriorityColor(win.priority)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1">
                <span className="text-lg flex-shrink-0">{getPriorityIcon(win.priority)}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-neutral-900">{win.title}</h3>
                  <p className="mt-0.5 text-xs text-neutral-600 truncate">{win.description}</p>
                </div>
              </div>
              <Link
                to={win.actionPath}
                className="flex-shrink-0 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 transition-colors"
              >
                {win.action}
              </Link>
            </div>
          </div>
        ))}
      </div>

      {hiddenWins > 0 && (
        <div className="mt-4 text-center">
          <Link
            to="/applications"
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            View {hiddenWins} more action{hiddenWins !== 1 ? 's' : ''} →
          </Link>
        </div>
      )}
    </div>
  );
}
