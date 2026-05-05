import { Link } from 'react-router-dom';
import { differenceInDays } from 'date-fns';
import type { Application } from '../types/application';

interface QuickWinsProps {
  applications: Application[];
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

export function QuickWins({ applications }: QuickWinsProps) {
  const quickWins: QuickWin[] = [];

  // High Priority: Interviews happening soon (next 7 days)
  const upcomingInterviews = applications.filter((app) => {
    if (app.status !== 'interview' && app.status !== 'phone_screen') return false;
    // In a real app, we'd check interview dates from app data
    // For now, we'll consider all interview-stage apps as upcoming
    return true;
  });

  upcomingInterviews.forEach((app) => {
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

  // High Priority: Stale applications in active stages (>7 days without update)
  const staleActiveApps = applications.filter((app) => {
    if (!['applied', 'phone_screen', 'interview'].includes(app.status)) return false;
    const daysSinceUpdate = differenceInDays(new Date(), new Date(app.updatedAt));
    return daysSinceUpdate > 7;
  });

  staleActiveApps.slice(0, 2).forEach((app) => {
    const daysSinceUpdate = differenceInDays(new Date(), new Date(app.updatedAt));
    quickWins.push({
      id: `stale-${app.id}`,
      priority: 'high',
      title: 'Follow Up Needed',
      description: `${app.company} - No update for ${daysSinceUpdate} days`,
      action: 'Send Follow-up',
      actionPath: `/applications/${app.id}`,
      applicationId: app.id,
    });
  });

  // Medium Priority: Applications missing job description (can't do fit analysis)
  const missingDescApps = applications.filter(
    (app) => !app.jobDescription && !['offer', 'rejected', 'withdrawn'].includes(app.status)
  );

  missingDescApps.slice(0, 2).forEach((app) => {
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

  // Medium Priority: Saved applications not yet applied (>3 days)
  const staleSavedApps = applications.filter((app) => {
    if (app.status !== 'saved') return false;
    const daysSinceSaved = differenceInDays(new Date(), new Date(app.createdAt));
    return daysSinceSaved > 3;
  });

  staleSavedApps.slice(0, 2).forEach((app) => {
    const daysSinceSaved = differenceInDays(new Date(), new Date(app.createdAt));
    quickWins.push({
      id: `saved-${app.id}`,
      priority: 'medium',
      title: 'Complete Application',
      description: `${app.company} - Saved ${daysSinceSaved} days ago`,
      action: 'Apply Now',
      actionPath: `/applications/${app.id}`,
      applicationId: app.id,
    });
  });

  // Sort by priority (high > medium > low) and limit to top 5
  const sortedWins = quickWins
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, 5);

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
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <span className="mb-3 text-4xl">🎉</span>
          <p className="text-sm font-medium text-success-700">All caught up!</p>
          <p className="mt-1 text-xs text-neutral-500">No urgent actions needed right now</p>
        </div>
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
          {sortedWins.length} action{sortedWins.length !== 1 ? 's' : ''}
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

      {quickWins.length > 5 && (
        <div className="mt-4 text-center">
          <Link
            to="/applications"
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            View {quickWins.length - 5} more action{quickWins.length - 5 !== 1 ? 's' : ''} →
          </Link>
        </div>
      )}
    </div>
  );
}
