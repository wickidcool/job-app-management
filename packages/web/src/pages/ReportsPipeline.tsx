import { useNavigate } from 'react-router-dom';
import { useApplications } from '../hooks/useApplications';
import { KanbanBoard } from '../components/KanbanBoard';
import type { ApplicationStatus } from '../types/application';
import { useUpdateApplication } from '../hooks/useApplications';

export function ReportsPipeline() {
  const navigate = useNavigate();
  const { data: applications = [], isLoading } = useApplications();
  const updateApplication = useUpdateApplication();

  // Filter to active statuses only (exclude terminal states)
  const activeApplications = applications.filter(
    (app) => !['offer', 'rejected', 'withdrawn'].includes(app.status)
  );

  const handleStatusChange = async (appId: string, newStatus: ApplicationStatus) => {
    const app = applications.find((a) => a.id === appId);
    if (!app) return;

    try {
      await updateApplication.mutateAsync({
        id: appId,
        data: { status: newStatus, version: app.version },
      });
    } catch (error) {
      console.error('Failed to update application status:', error);
    }
  };

  const handleCardClick = (appId: string) => {
    navigate(`/applications/${appId}`);
  };

  const calculateStats = () => {
    const stats = {
      total: activeApplications.length,
      dueToday: 0,
      dueSoon: 0,
      overdue: 0,
      stale: 0,
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    activeApplications.forEach((app) => {
      // Check due dates
      if (app.nextActionDue) {
        const dueDate = new Date(app.nextActionDue);
        dueDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          stats.overdue++;
        } else if (diffDays === 0) {
          stats.dueToday++;
        } else if (diffDays <= 7) {
          stats.dueSoon++;
        }
      }

      // Check stale (14+ days)
      const updatedAt = new Date(app.updatedAt);
      const daysSinceUpdate = Math.floor(
        (today.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceUpdate >= 14) {
        stats.stale++;
      }
    });

    return stats;
  };

  const stats = calculateStats();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center">Loading pipeline report...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900">Pipeline Report</h1>
        <p className="mt-2 text-neutral-600">
          Active applications grouped by status with due dates and stale indicators
        </p>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-bold text-neutral-900">{stats.total}</div>
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

      {/* Kanban Board */}
      <KanbanBoard
        applications={activeApplications}
        onStatusChange={handleStatusChange}
        onCardClick={handleCardClick}
        loading={isLoading}
      />
    </div>
  );
}
