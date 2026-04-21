import { Link } from 'react-router-dom';
import { DashboardStats } from '../components/DashboardStats';
import { DashboardResumeWidget } from '../components/DashboardResumeWidget';
import { useApplications } from '../hooks/useApplications';
import { useDashboard } from '../hooks/useDashboard';
import { useResumes } from '../hooks/useResumes';
import type { ApplicationStatus } from '../types/application';

export function Dashboard() {
  const { data: applications = [], isLoading: applicationsLoading } =
    useApplications();
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboard();
  const { data: resumes = [], isLoading: resumesLoading } = useResumes();

  const loading = applicationsLoading || dashboardLoading || resumesLoading;

  const stats = dashboardData?.stats || {
    total: applications.length,
    byStatus: {} as Record<ApplicationStatus, number>,
    appliedThisWeek: 0,
    appliedThisMonth: 0,
    responseRate: 0,
  };

  const displayStats = {
    total: stats.total,
    appliedThisWeek: stats.appliedThisWeek,
    responseRate: stats.responseRate,
    inReview: stats.byStatus.phone_screen + stats.byStatus.interview || 0,
  };

  const inProgressCount =
    (stats.byStatus.phone_screen || 0) + (stats.byStatus.interview || 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Dashboard</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Track your job applications and manage your resumes
        </p>
      </div>

      <div className="mb-6">
        <DashboardStats stats={displayStats} loading={loading} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">📋</span>
              <h2 className="text-lg font-semibold text-neutral-900">
                Quick Actions
              </h2>
            </div>
          </div>
          <div className="space-y-2">
            <Link
              to="/applications/new"
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>➕</span>
              <span>Add Application</span>
            </Link>
            <Link
              to="/resumes/upload"
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>📄</span>
              <span>Upload Resume</span>
            </Link>
            <Link
              to="/applications"
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>📊</span>
              <span>View All Applications</span>
            </Link>
          </div>
        </div>

        <DashboardResumeWidget
          masterResumeCount={resumes.length}
          exportCount={resumes.length}
          loading={loading}
        />

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">📈</span>
              <h2 className="text-lg font-semibold text-neutral-900">
                Recent Activity
              </h2>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">In Progress</span>
              <span className="font-semibold text-neutral-900">
                {inProgressCount}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">Applied This Week</span>
              <span className="font-semibold text-neutral-900">
                {stats.appliedThisWeek}
              </span>
            </div>
            <Link
              to="/applications"
              className="mt-4 block rounded-lg border border-primary-600 px-4 py-2 text-center text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              View All Applications
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
