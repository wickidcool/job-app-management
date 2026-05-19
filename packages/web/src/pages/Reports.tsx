import { Link } from 'react-router-dom';

interface ReportCard {
  title: string;
  description: string;
  icon: string;
  path: string;
  badge?: string;
}

export function Reports() {
  const reports: ReportCard[] = [
    {
      title: 'Pipeline',
      description: 'Enhanced Kanban view with due dates and stale indicators',
      icon: '📊',
      path: '/reports/pipeline',
    },
    {
      title: 'Needs Action',
      description: 'Urgent tasks grouped by overdue, today, and this week',
      icon: '⚡',
      path: '/reports/needs-action',
    },
    {
      title: 'Stale',
      description: 'Applications needing follow-up (14+ days since update)',
      icon: '⏱️',
      path: '/reports/stale',
    },
    {
      title: 'Closed Loop',
      description: 'Outcome analysis with patterns and insights',
      icon: '🔄',
      path: '/reports/closed-loop',
    },
    {
      title: 'By Fit Tier',
      description: 'Priority grouping by fit score',
      icon: '🎯',
      path: '/reports/by-fit-tier',
      badge: 'Requires UC-3',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900">Reports</h1>
        <p className="mt-2 text-neutral-600">
          Analyze your job search pipeline with specialized reports
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <Link
            key={report.path}
            to={report.path}
            className="group relative flex flex-col rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
          >
            <div className="mb-4 flex items-start justify-between">
              <span className="text-4xl">{report.icon}</span>
              {report.badge && (
                <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600">
                  {report.badge}
                </span>
              )}
            </div>
            <h2 className="mb-2 text-xl font-semibold text-neutral-900 group-hover:text-primary-600">
              {report.title}
            </h2>
            <p className="text-sm text-neutral-600">{report.description}</p>
            <div className="mt-4 flex items-center text-sm font-medium text-primary-600">
              View Report
              <svg
                className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
