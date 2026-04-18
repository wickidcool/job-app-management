import { useNavigate } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';

export function ResumeUpload() {
  const navigate = useNavigate();

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager', href: '/resumes' },
    { label: 'Upload Resume' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Upload Resume</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Upload your resume to extract work experience and skills
        </p>
      </div>

      <ResumeManagerTabs />

      <div className="mt-8">
        <div className="rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-12 text-center">
          <div className="mb-4 text-6xl">📄</div>
          <h3 className="mb-2 text-lg font-medium text-neutral-900">
            Drag & drop your resume here
          </h3>
          <p className="mb-4 text-sm text-neutral-600">
            or click to browse
          </p>
          <p className="text-xs text-neutral-500">
            PDF, DOCX, TXT (Max 10MB)
          </p>
          <button
            onClick={() => navigate('/resumes')}
            className="mt-6 rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
