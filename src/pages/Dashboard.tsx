import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { KanbanBoard } from '../components/KanbanBoard';
import { FilterPanel, FilterOptions } from '../components/FilterPanel';
import { ApplicationForm } from '../components/ApplicationForm';
import { DashboardStats } from '../components/DashboardStats';
import { mockApplicationService } from '../services/mockApplicationService';
import type { Application, ApplicationFormData, ApplicationStatus } from '../types/application';

type ViewMode = 'kanban' | 'table';

export function Dashboard() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[]>([]);
  const [filteredApplications, setFilteredApplications] = useState<Application[]>([]);
  const [filters, setFilters] = useState<FilterOptions>({});
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState<Application | null>(null);

  // Load applications
  useEffect(() => {
    loadApplications();
  }, []);

  // Apply filters
  useEffect(() => {
    applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applications, filters]);

  const loadApplications = async () => {
    setLoading(true);
    try {
      const apps = await mockApplicationService.getAll();
      setApplications(apps);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
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

    setFilteredApplications(filtered);
  };

  const handleStatusChange = async (appId: string, newStatus: ApplicationStatus) => {
    try {
      await mockApplicationService.updateStatus(appId, newStatus);
      await loadApplications();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
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

  const handleDelete = async (appId: string) => {
    try {
      await mockApplicationService.delete(appId);
      await loadApplications();
    } catch (error) {
      console.error('Failed to delete application:', error);
    }
  };

  const handleFormSubmit = async (data: ApplicationFormData) => {
    try {
      if (editingApplication) {
        await mockApplicationService.update(editingApplication.id, data);
      } else {
        await mockApplicationService.create(data);
      }
      await loadApplications();
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

  // Calculate stats
  const stats = {
    total: applications.length,
    appliedThisWeek: applications.filter((app) => {
      if (!app.appliedAt) return false;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return app.appliedAt >= weekAgo;
    }).length,
    responseRate:
      applications.filter((app) => ['phone_screen', 'interview', 'offer'].includes(app.status))
        .length /
        applications.filter((app) => app.status !== 'saved').length || 0,
    inReview: applications.filter((app) =>
      ['phone_screen', 'interview'].includes(app.status)
    ).length,
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
          <DashboardStats stats={stats} loading={loading} />
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
