import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { track } from '../services/analytics';
import { Announcer } from '../components/Announcer';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { EmptyState } from '../components/EmptyState';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useResumes, useDeleteResume } from '../hooks/useResumes';
import { useGenerateDiff } from '../hooks/useCatalog';

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
  const navigate = useNavigate();
  const { data: resumes, isLoading, error } = useResumes();
  const deleteResume = useDeleteResume();
  const generateDiff = useGenerateDiff();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resumeToDelete, setResumeToDelete] = useState<{
    id: string;
    fileName: string;
  } | null>(null);
  const { message: announcement, announce, clear: clearAnnouncement } = useAnnouncer();

  // Where focus goes when a delete succeeds. The trigger is the per-row 🗑️ Delete
  // button, so the confirmed action destroys it — see WIC-1181. This has to be an
  // element that survives *both* arms of the `hasResumes` branch below: the list
  // container is inside it and unmounts when the last resume goes, and `EmptyState`
  // does not exist yet at close time on the other side. The section wrapping them
  // both is always mounted, and it is the part of the page the user just changed.
  const resumeListRef = useRef<HTMLDivElement | null>(null);

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager' },
  ];

  const hasResumes = resumes && resumes.length > 0;

  // Fire resume_manager_viewed once per mount, after the resume list has loaded
  // so resume_count reflects the real count shown.
  const viewedTracked = useRef(false);
  useEffect(() => {
    if (!isLoading && !error && resumes && !viewedTracked.current) {
      viewedTracked.current = true;
      track('resume_manager_viewed', { resume_count: resumes.length });
    }
  }, [isLoading, error, resumes]);

  const handleDeleteClick = (id: string, fileName: string) => {
    setResumeToDelete({ id, fileName });
    setDeleteModalOpen(true);
    // Emptying the region as the dialog opens keeps the previous outcome from
    // lingering in the accessibility tree while the user works on the next one.
    // Emptying is itself silent, so this announces nothing — same reason
    // `ProjectsList` clears on open.
    //
    // This clear is deliberately NOT what makes a repeated announcement audible.
    // Uploads dedupe on contentHash, not fileName (`resume.service.ts`), so two
    // resumes called "resume.pdf" are ordinary, and deleting the second assigns a
    // string identical to the first announcement. `useAnnouncer.announce` handles
    // that case itself by alternating an unspoken marker, so the re-announce
    // survives even if this clear is removed. Do not restore this line's old
    // rationale: it described a `useState` the page no longer has.
    clearAnnouncement();
  };

  const handleConfirmDelete = async () => {
    if (!resumeToDelete) return;
    const { fileName } = resumeToDelete;

    try {
      await deleteResume.mutateAsync(resumeToDelete.id);
      setDeleteModalOpen(false);
      setResumeToDelete(null);
      // Moving focus is not the same as telling someone what happened. Delete is
      // the app's only irreversible action, and a screen-reader user who lands on
      // the list gets no confirmation from the focus move alone.
      announce(`Resume "${fileName}" deleted.`);
    } catch (error) {
      console.error('Failed to delete resume:', error);
      alert('Failed to delete resume. Please try again.');
    }
  };

  const handleCancelDelete = () => {
    setDeleteModalOpen(false);
    setResumeToDelete(null);
  };

  const handleGenerateDiff = async (resumeId: string) => {
    try {
      await generateDiff.mutateAsync({
        sourceType: 'resume',
        sourceId: resumeId,
      });
      navigate('/catalog');
    } catch (error) {
      console.error('Failed to generate diff:', error);
      alert('Failed to generate diff. Please try again.');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Resume Manager</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Manage your master resumes and create tailored exports for each job application
        </p>
      </div>

      <ResumeManagerTabs />

      {/*
        Announces the result of a delete. `Announcer` portals the region to
        <body>, so its position in this tree is presentational only — and the
        reasons it must stay portalled, permanently mounted, and wrapping no
        control live in that component rather than being restated here.

        The one page-specific point: for those same reasons it must not move
        back inside `EmptyState`, which unmounts with the last resume.
      */}
      <Announcer message={announcement} />

      <div
        ref={resumeListRef}
        tabIndex={-1}
        role="region"
        aria-label="Resumes"
        className="mt-8 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
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
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="text-3xl flex-shrink-0">
                    {resume.mimeType === 'application/pdf' ? '📄' : '📝'}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-medium text-neutral-900 truncate">{resume.fileName}</h2>
                    <p className="text-sm text-neutral-500">
                      {formatFileSize(resume.fileSize)} • Uploaded {formatDate(resume.uploadedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:flex-shrink-0">
                  <button
                    onClick={() => handleGenerateDiff(resume.id)}
                    disabled={generateDiff.isPending}
                    className="rounded-lg border border-primary-300 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Generate catalog diff"
                  >
                    📊 {generateDiff.isPending ? 'Generating...' : 'Generate Diff'}
                  </button>
                  <Link
                    to={`/resumes/${resume.id}/exports`}
                    onClick={() =>
                      track('resume_exports_link_clicked', {
                        resume_id: resume.id,
                        resume_file_type: resume.mimeType === 'application/pdf' ? 'pdf' : 'docx',
                      })
                    }
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
        restoreFocusTo={resumeListRef}
      />
    </div>
  );
}
