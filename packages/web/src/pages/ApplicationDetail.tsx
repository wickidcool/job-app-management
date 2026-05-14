import { useParams, useNavigate, Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { useState } from 'react';
import {
  useApplication,
  useUpdateApplicationStatus,
  useDeleteApplication,
  useUpdateApplication,
} from '../hooks/useApplications';
import { StatusBadge } from '../components/StatusBadge';
import { StatusDropdown } from '../components/StatusDropdown';
import { ApplicationForm } from '../components/ApplicationForm';
import { WorkflowChecklist } from '../components/WorkflowChecklist';
import { Breadcrumb } from '../components/Breadcrumb';
import type { ApplicationStatus, ApplicationFormData } from '../types/application';

export function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Fetch data using React Query
  const { data: application, isLoading: loading } = useApplication(id);
  const updateStatusMutation = useUpdateApplicationStatus();
  const updateMutation = useUpdateApplication();
  const deleteMutation = useDeleteApplication();

  const handleStatusChange = (newStatus: ApplicationStatus) => {
    if (!id || !application) return;

    updateStatusMutation.mutate(
      { id, status: newStatus, version: application.version },
      {
        onError: (error) => {
          console.error('Failed to update status:', error);
          // TODO: Show error toast
        },
      }
    );
  };

  const handleEdit = async (data: ApplicationFormData) => {
    if (!id || !application) return;

    await updateMutation.mutateAsync({
      id,
      data,
      version: application.version,
    });

    setIsEditOpen(false);
  };

  const handleDelete = () => {
    if (!application) return;

    if (confirm(`Are you sure you want to delete the application for ${application.jobTitle}?`)) {
      deleteMutation.mutate(id!, {
        onSuccess: () => {
          navigate('/');
        },
        onError: (error) => {
          console.error('Failed to delete application:', error);
          // TODO: Show error toast
        },
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">Application not found</p>
            <Link to="/" className="text-blue-600 hover:text-blue-700">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/' },
    { label: 'Applications', href: '/applications' },
    { label: application.company },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <Breadcrumb trail={breadcrumbTrail} />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Application Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                {application.jobTitle}
              </h1>
              <p className="text-lg sm:text-xl text-gray-600 mb-4">{application.company}</p>

              {/* Status Badge */}
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <StatusBadge status={application.status} variant="filled" />
                <StatusDropdown
                  currentStatus={application.status}
                  onStatusChange={handleStatusChange}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
              {application.status === 'interview' && (
                <button
                  onClick={() => navigate(`/applications/${id}/prep`)}
                  className="px-4 py-2 text-sm font-medium text-purple-700 bg-white border border-purple-300 rounded-md hover:bg-purple-50"
                >
                  Prepare for Interview
                </button>
              )}
              <button
                onClick={() => setIsEditOpen(true)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Workflow Checklist */}
        <div className="mb-6">
          <WorkflowChecklist
            applicationId={id!}
            status={application.status}
            hasJobDescription={!!application.jobDescription}
          />
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Details</h2>
            <dl className="space-y-3">
              {application.location && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Location</dt>
                  <dd className="text-sm text-gray-900">{application.location}</dd>
                </div>
              )}
              {application.salaryRange && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Salary Range</dt>
                  <dd className="text-sm text-gray-900">{application.salaryRange}</dd>
                </div>
              )}
              {application.url && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Job Posting</dt>
                  <dd className="text-sm">
                    <a
                      href={application.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700"
                    >
                      View Posting →
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Timeline</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Created</dt>
                <dd className="text-sm text-gray-900">
                  {formatDistanceToNow(application.createdAt, { addSuffix: true })}
                </dd>
              </div>
              {application.appliedAt && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Applied</dt>
                  <dd className="text-sm text-gray-900">
                    {formatDistanceToNow(application.appliedAt, { addSuffix: true })}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500">Last Updated</dt>
                <dd className="text-sm text-gray-900">
                  {formatDistanceToNow(application.updatedAt, { addSuffix: true })}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Extended Tracking (UC-5 fields) */}
        {(application.contact ||
          application.compTarget ||
          application.nextAction ||
          application.nextActionDue) && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Tracking</h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {application.contact && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Contact</dt>
                  <dd className="text-sm text-gray-900">{application.contact}</dd>
                </div>
              )}
              {application.compTarget && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Comp Target</dt>
                  <dd className="text-sm text-gray-900">{application.compTarget}</dd>
                </div>
              )}
              {application.nextAction && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Next Action</dt>
                  <dd className="text-sm text-gray-900">{application.nextAction}</dd>
                </div>
              )}
              {application.nextActionDue && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Next Action Due</dt>
                  <dd className="text-sm text-gray-900">
                    {format(new Date(application.nextActionDue), 'MMM d, yyyy')}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Job Description */}
        {application.jobDescription && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Job Description</h2>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">
              {application.jobDescription}
            </div>
          </div>
        )}

        {/* Documents Section (Placeholder) */}
        {application.hasDocuments && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Documents</h2>
            <p className="text-sm text-gray-500">Document management coming soon...</p>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <ApplicationForm
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        onSubmit={handleEdit}
        application={application}
        mode="edit"
      />
    </div>
  );
}
