import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { EmptyState } from '../components/EmptyState';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useResumes, useDeleteResume } from '../hooks/useResumes';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ResumeManager() {
  const { data: resumes, isLoading, error } = useResumes();
  const deleteResume = useDeleteResume();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resumeToDelete, setResumeToDelete] = useState<{
    id: string;
    fileName: string;
  } | null>(null);

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager' },
  ];

  const hasResumes = resumes && resumes.length > 0;

  const handleDeleteClick = (id: string, fileName: string) => {
    setResumeToDelete({ id, fileName });
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!resumeToDelete) return;

    try {
      await deleteResume.mutateAsync(resumeToDelete.id);
      setDeleteModalOpen(false);
      setResumeToDelete(null);
    } catch (error) {
      console.error('Failed to delete resume:', error);
      alert('Failed to delete resume. Please try again.');
    }
  };

  const handleCancelDelete = () => {
    setDeleteModalOpen(false);
    setResumeToDelete(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Resume Manager</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Manage your master resumes and create tailored exports for each job
          application
        </p>
      </div>

      <ResumeManagerTabs />

      <div className="mt-8">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-neutral-500">Loading resumes...</div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-red-700">Failed to load resumes. Please try again.</p>
          </div>
        )}

        {!isLoading && !error && !hasResumes && (
          <EmptyState
            variant="no-documents"
            onAction={() => (window.location.href = '/resumes/upload')}
            actionLabel="Upload Your First Resume"
          />
        )}

        {!isLoading && !error && hasResumes && (
          <div className="space-y-4">
            {resumes.map((resume) => (
              <div
                key={resume.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4">
                  <div className="text-3xl">
                    {resume.mimeType === 'application/pdf' ? '📄' : '📝'}
                  </div>
                  <div>
                    <h3 className="font-medium text-neutral-900">{resume.fileName}</h3>
                    <p className="text-sm text-neutral-500">
                      {formatFileSize(resume.fileSize)} • Uploaded {formatDate(resume.uploadedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/resumes/${resume.id}/exports`}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    View Exports
                  </Link>
                  <button
                    onClick={() => handleDeleteClick(resume.id, resume.fileName)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete resume"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={deleteModalOpen}
        title="Delete Resume"
        message={`Are you sure you want to delete "${resumeToDelete?.fileName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
