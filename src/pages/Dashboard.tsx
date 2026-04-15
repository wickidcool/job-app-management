import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { KanbanBoard } from '../components/KanbanBoard';
import { FilterPanel, type FilterOptions } from '../components/FilterPanel';
import { ApplicationForm } from '../components/ApplicationForm';
import { DashboardStats } from '../components/DashboardStats';
import {
  useApplications,
  useCreateApplication,
  useUpdateApplication,
  useUpdateApplicationStatus,
  useDeleteApplication,
} from '../hooks/useApplications';
import { useDashboard } from '../hooks/useDashboard';
import type { Application, ApplicationFormData, ApplicationStatus } from '../types/application';

type ViewMode = 'kanban' | 'table';

export function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterOptions>({});
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState<Application | null>(null);

  // Fetch data using React Query
  const { data: applications = [], isLoading: applicationsLoading } = useApplications();
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboard();
  const createMutation = useCreateApplication();
  const updateMutation = useUpdateApplication();
  const updateStatusMutation = useUpdateApplicationStatus();
  const deleteMutation = useDeleteApplication();

  const loading = applicationsLoading || dashboardLoading;

  // Apply filters using useMemo
  const filteredApplications = useMemo(() => {
    let filtered = [...applications];

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(
        (app) =>
          app.jobTitle.toLowerCase().includes(searchLower) ||
          app.company.toLowerCase().includes(searchLower)
      );
    }

    // Status filter
    if (filters.status && filters.status.length > 0) {
      filtered = filtered.filter((app) => filters.status!.includes(app.status));
    }

    // Company filter
    if (filters.company && filters.company.length > 0) {
      filtered = filtered.filter((app) => filters.company!.includes(app.company));
    }

    return filtered;
  }, [applications, filters]);

  const handleStatusChange = (appId: string, newStatus: ApplicationStatus) => {
    const app = applications.find((a) => a.id === appId);
    if (!app) return;

    updateStatusMutation.mutate(
      { id: appId, status: newStatus, version: app.version },
      {
        onError: (error) => {
          console.error('Failed to update status:', error);
          // TODO: Show error toast
        },
      }
    );
  };

  const handleCardClick = (appId: string) => {
    navigate(`/applications/${appId}`);
  };

  const handleEdit = (appId: string) => {
    const app = applications.find((a) => a.id === appId);
    if (app) {
      setEditingApplication(app);
      setIsFormOpen(true);
    }
  };

  const handleDelete = (appId: string) => {
    if (confirm('Are you sure you want to delete this application?')) {
      deleteMutation.mutate(appId, {
        onError: (error) => {
          console.error('Failed to delete application:', error);
          // TODO: Show error toast
        },
      });
    }
  };

  const handleFormSubmit = async (data: ApplicationFormData) => {
    try {
      if (editingApplication) {
        await updateMutation.mutateAsync({
          id: editingApplication.id,
          data,
          version: editingApplication.version,
        });
      } else {
        await createMutation.mutateAsync(data);
      }
      setIsFormOpen(false);
      setEditingApplication(null);
    } catch (error) {
      console.error('Failed to save application:', error);
      throw error;
    }
  };

  const handleOpenForm = () => {
    setEditingApplication(null);
    setIsFormOpen(true);
  };

  // Use stats from dashboard API or fallback to calculated stats
  const stats = dashboardData?.stats || {
    total: applications.length,
    byStatus: {} as Record<ApplicationStatus, number>,
    appliedThisWeek: 0,
    appliedThisMonth: 0,
    responseRate: 0,
  };

  // Transform stats for DashboardStats component
  const displayStats = {
    total: stats.total,
    appliedThisWeek: stats.appliedThisWeek,
    responseRate: stats.responseRate,
    inReview: stats.byStatus.phone_screen + stats.byStatus.interview || 0,
  };

  const availableCompanies = Array.from(new Set(applications.map((app) => app.company))).sort();
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Job Application Manager</h1>
          <button
            onClick={handleOpenForm}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            + Add Application
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Dashboard Stats */}
        <div className="mb-6">
          <DashboardStats stats={displayStats} loading={loading} />
        </div>

        {/* View Toggle and Filter */}
        <div className="mb-6 flex items-start gap-6">
          {/* Filter Panel */}
          <div className="w-80 flex-shrink-0">
            <FilterPanel
              onFilterChange={setFilters}
              activeFilters={filters}
              availableCompanies={availableCompanies}
              availableStatuses={availableStatuses}
            />
          </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* View Toggle */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1">
                <button
                  onClick={() => setViewMode('kanban')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'kanban'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Kanban
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'table'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Table
                </button>
              </div>

              <div className="text-sm text-gray-600">
                Showing {filteredApplications.length} of {applications.length} applications
              </div>
            </div>

            {/* Content */}
            {viewMode === 'kanban' ? (
              <KanbanBoard
                applications={filteredApplications}
                onStatusChange={handleStatusChange}
                onCardClick={handleCardClick}
                onEdit={handleEdit}
                onDelete={handleDelete}
                loading={loading}
              />
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-gray-500">Table view coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Application Form Modal */}
      <ApplicationForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleFormSubmit}
        application={editingApplication}
        mode={editingApplication ? 'edit' : 'create'}
      />
    </div>
  );
}
