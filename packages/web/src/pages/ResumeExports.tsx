import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { ResumeExportList } from '../components/ResumeExportList';
import type { ExportFormat } from '../types/resume';
import { track } from '../services/analytics';
import { useResumeExports } from '../hooks/useExports';

export function ResumeExports() {
  const navigate = useNavigate();
  // resumeId is present when arriving via /resumes/:resumeId/exports; the flat
  // /resumes/exports route leaves it undefined and shows every resume's exports.
  const { resumeId } = useParams<{ resumeId?: string }>();
  const { data: exports = [], isLoading, error } = useResumeExports(resumeId);

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager', href: '/resumes' },
    { label: 'Exports' },
  ];

  const handlePreview = (exportId: string) => {
    // Read resume_id off the export row rather than the route param: the flat
    // /resumes/exports route has no param, and sending '' there would land an
    // empty string in PostHog as a real breakdown bucket (WIC-1707).
    const exportItem = exports.find((item) => item.id === exportId);
    if (!exportItem) return;

    track('export_viewed', {
      resume_id: exportItem.resumeId,
      export_id: exportItem.id,
      export_type: 'star_markdown',
    });
    console.log('Preview export:', exportId);
    // TODO: Open preview modal or navigate to export detail
  };

  const handleDownload = (exportId: string, format: ExportFormat) => {
    console.log('Download export:', exportId, format);
    // TODO: Trigger download API call
  };

  const handleDelete = (exportId: string) => {
    console.log('Delete export:', exportId);
    // TODO: Show confirmation dialog and delete
  };

  const handleCreateNew = () => {
    navigate('/resume-variants/new');
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Resume Exports</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Tailored resume versions for specific job applications
        </p>
      </div>

      <ResumeManagerTabs />

      {error && (
        <div className="mt-8 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">Failed to load resume exports. Please try again.</p>
        </div>
      )}

      <div className="mt-8">
        <ResumeExportList
          exports={exports}
          loading={isLoading}
          onPreview={handlePreview}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onCreateNew={handleCreateNew}
        />
      </div>
    </div>
  );
}
