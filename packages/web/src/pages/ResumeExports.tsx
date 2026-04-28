import { useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { ResumeExportList } from '../components/ResumeExportList';
import type { ResumeExport, ExportFormat } from '../types/resume';

export function ResumeExports() {
  const navigate = useNavigate();

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager', href: '/resumes' },
    { label: 'Exports' },
  ];

  // TODO: Replace with actual data from API
  const exports: ResumeExport[] = [];

  const handlePreview = (exportId: string) => {
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

      <div className="mt-8">
        <ResumeExportList
          exports={exports}
          onPreview={handlePreview}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onCreateNew={handleCreateNew}
        />
      </div>
    </div>
  );
}
