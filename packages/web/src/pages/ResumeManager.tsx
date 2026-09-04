import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { track } from '../services/analytics';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { EmptyState } from '../components/EmptyState';
import { ConfirmationModal } from '../components/ConfirmationModal';
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
  const [deleteAnnouncement, setDeleteAnnouncement] = useState('');

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
    // Clear the previous announcement as the dialog opens, so the next one is a
    // real change to the live region rather than a re-set of the same string.
    // Uploads dedupe on contentHash, not fileName (`resume.service.ts`), so two
    // resumes called "resume.pdf" are ordinary — and deleting the second would
    // otherwise assign a string identical to the first announcement, React would
    // bail on Object.is, no text node would mutate, and assistive tech would say
    // nothing at all about an irreversible action. Clearing here rather than
    // around the set in handleConfirmDelete keeps the two writes in separate
    // commits driven by separate user actions, so neither can be batched away.
    setDeleteAnnouncement('');
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
      setDeleteAnnouncement(`Resume "${fileName}" deleted.`);
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
        Announces the result of a delete, portalled to <body> so that it sits
        *outside* #root rather than inside it.

        `aria-hidden` — the package Radix uses to hide the background behind a
        modal — exempts `[aria-live]` elements, and the exemption covers the
        node's entire ancestor chain. A live region rendered in place would
        therefore stop #root itself being hidden behind every open dialog, which
        is the WIC-1155 defect reached from the other side. As a body-level
        sibling it is exempted on its own, hides nothing, and wraps no control,
        so there is no interactive element for the exemption to leak.

        It also has to be permanently mounted and merely change text: assistive
        tech only announces updates to a region already in the accessibility
        tree. For the same two reasons it must not move back into `EmptyState`.
      */}
      {createPortal(
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {deleteAnnouncement}
        </div>,
        document.body
      )}

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
