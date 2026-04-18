import { useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { KanbanBoard } from '../components/KanbanBoard';
import { FilterPanel } from '../components/FilterPanel';
import {
  useApplications,
  useUpdateApplicationStatus,
} from '../hooks/useApplications';
import type { ApplicationStatus } from '../types/application';

export function ApplicationsList() {
  const navigate = useNavigate();
  const { data: applications = [], isLoading } = useApplications();
  const updateStatusMutation = useUpdateApplicationStatus();

  const handleStatusChange = (appId: string, newStatus: ApplicationStatus) => {
    const app = applications.find((a) => a.id === appId);
    if (!app) return;

    updateStatusMutation.mutate(
      { id: appId, status: newStatus, version: app.version },
      {
        onError: (error) => {
          console.error('Failed to update status:', error);
        },
      }
    );
  };

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Applications' },
  ];

  const availableCompanies = Array.from(
    new Set(applications.map((app) => app.company))
  ).sort();
  const availableStatuses: ApplicationStatus[] = [
    'saved',
    'applied',
    'phone_screen',
    'interview',
    'offer',
    'rejected',
    'withdrawn',
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-neutral-900">Applications</h1>
      </div>

      <div className="mb-6">
        <FilterPanel
          onFilterChange={() => {}}
          activeFilters={{}}
          availableCompanies={availableCompanies}
          availableStatuses={availableStatuses}
        />
      </div>

      <KanbanBoard
        applications={applications}
        onStatusChange={handleStatusChange}
        onCardClick={(id) => navigate(`/applications/${id}`)}
        loading={isLoading}
      />
    </div>
  );
}
