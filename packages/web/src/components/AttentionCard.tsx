import { Link } from 'react-router-dom';
import { differenceInDays } from 'date-fns';
import type { Application } from '../types/application';

interface AttentionCardProps {
  applications: Application[];
}

interface AttentionItem {
  type: 'critical' | 'warning' | 'success';
  icon: string;
  message: string;
  link?: string;
  count?: number;
}

export function AttentionCard({ applications }: AttentionCardProps) {
  const items: AttentionItem[] = [];

  // Check for upcoming interviews
  const interviewApps = applications.filter(
    (app) => app.status === 'interview' || app.status === 'phone_screen'
  );

  if (interviewApps.length > 0) {
    items.push({
      type: 'critical',
      icon: '🔴',
      message: `${interviewApps.length} interview${interviewApps.length > 1 ? 's' : ''} in progress`,
      link: '/applications?status=interview,phone_screen',
      count: interviewApps.length,
    });
  }

  // Check for stale applications (>14 days in same status)
  const staleApps = applications.filter((app) => {
    if (app.status === 'offer' || app.status === 'rejected' || app.status === 'withdrawn') {
      return false; // Terminal statuses don't go stale
    }
    const daysSinceUpdate = differenceInDays(new Date(), new Date(app.updatedAt));
    return daysSinceUpdate > 14;
  });

  if (staleApps.length > 0) {
    items.push({
      type: 'warning',
      icon: '🟡',
      message: `${staleApps.length} application${staleApps.length > 1 ? 's' : ''} need follow-up (>14 days)`,
      link: '/reports/stale',
      count: staleApps.length,
    });
  }

  // Check for applications without job descriptions (can't do fit analysis)
  const missingDescApps = applications.filter(
    (app) =>
      !app.jobDescription &&
      app.status !== 'offer' &&
      app.status !== 'rejected' &&
      app.status !== 'withdrawn'
  );

  if (missingDescApps.length > 0 && missingDescApps.length <= 5) {
    items.push({
      type: 'warning',
      icon: '📝',
      message: `${missingDescApps.length} application${missingDescApps.length > 1 ? 's' : ''} missing job description`,
      link: '/applications',
      count: missingDescApps.length,
    });
  }

  // Success message when everything is in good shape
  if (items.length === 0) {
    items.push({
      type: 'success',
      icon: '🟢',
      message: 'All applications are up to date!',
    });
  }

  const getTypeColor = (type: AttentionItem['type']) => {
    switch (type) {
      case 'critical':
        return 'bg-error-50 border-error-200';
      case 'warning':
        return 'bg-warning-50 border-warning-200';
      case 'success':
        return 'bg-success-50 border-success-200';
    }
  };

  const getTextColor = (type: AttentionItem['type']) => {
    switch (type) {
      case 'critical':
        return 'text-error-800';
      case 'warning':
        return 'text-warning-800';
      case 'success':
        return 'text-success-800';
    }
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <h2 className="text-lg font-semibold text-neutral-900">Attention Required</h2>
        </div>
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={index}
            className={`rounded-lg border p-3 ${getTypeColor(item.type)}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-lg">{item.icon}</span>
              <div className="flex-1">
                {item.link ? (
                  <Link
                    to={item.link}
                    className={`text-sm font-medium hover:underline ${getTextColor(item.type)}`}
                  >
                    {item.message} →
                  </Link>
                ) : (
                  <p className={`text-sm font-medium ${getTextColor(item.type)}`}>
                    {item.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {interviewApps.length > 0 && (
        <div className="mt-4">
          <Link
            to="/applications?status=interview"
            className="block rounded-lg border border-error-600 bg-error-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-error-700"
          >
            Prepare for Interviews
          </Link>
        </div>
      )}
    </div>
  );
}
