import { Link } from 'react-router-dom';
import type { DashboardAttention } from '../services/api/types';

interface AttentionCardProps {
  /**
   * Server-computed aggregates over *every* application.
   *
   * This card must never derive its counts from a list of applications held by
   * the client: `GET /api/applications` returns a page ordered by most-recently
   * updated, so filtering it for the *least* recently updated rows drops exactly
   * the ones this card exists to surface.
   */
  attention?: DashboardAttention;
}

interface AttentionItem {
  type: 'critical' | 'warning' | 'success';
  icon: string;
  message: string;
  link?: string;
  count?: number;
}

export function AttentionCard({ attention }: AttentionCardProps) {
  const items: AttentionItem[] = [];
  const counts = attention?.counts;
  const interviewCount = counts?.interviewing ?? 0;
  const staleThresholdDays = attention?.staleThresholdDays ?? 7;

  // Check for upcoming interviews
  if (interviewCount > 0) {
    items.push({
      type: 'critical',
      icon: '🔴',
      message: `${interviewCount} interview${interviewCount > 1 ? 's' : ''} in progress`,
      link: '/applications?status=interview,phone_screen',
      count: interviewCount,
    });
  }

  // Check for stale applications (no update in the stale window)
  const staleCount = counts?.stale ?? 0;

  if (staleCount > 0) {
    items.push({
      type: 'warning',
      icon: '🟡',
      message: `${staleCount} application${staleCount > 1 ? 's' : ''} need follow-up (>${staleThresholdDays} days)`,
      link: '/reports/stale',
      count: staleCount,
    });
  }

  // Check for applications without job descriptions (can't do fit analysis)
  const missingDescCount = counts?.missingJobDescription ?? 0;

  if (missingDescCount > 0 && missingDescCount <= 5) {
    items.push({
      type: 'warning',
      icon: '📝',
      message: `${missingDescCount} application${missingDescCount > 1 ? 's' : ''} missing job description`,
      link: '/applications',
      count: missingDescCount,
    });
  }

  // Success message when everything is in good shape.
  // Only claim this once the aggregates have actually arrived — with no data
  // there is nothing to be up to date about.
  if (items.length === 0 && attention) {
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
          <div key={index} className={`rounded-lg border p-3 ${getTypeColor(item.type)}`}>
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
                  <p className={`text-sm font-medium ${getTextColor(item.type)}`}>{item.message}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {interviewCount > 0 && (
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
