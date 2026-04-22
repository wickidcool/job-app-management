import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { ResumeUpload as ResumeUploadComponent } from '../components/ResumeUpload';
import { resumeKeys } from '../hooks/useResumes';

export function ResumeUpload() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager', href: '/resumes' },
    { label: 'Upload Resume' },
  ];

  const handleUploadComplete = () => {
    queryClient.invalidateQueries({ queryKey: resumeKeys.all });
    const returnTo = searchParams.get('returnTo') || '/resumes';
    navigate(returnTo);
  };

  const handleUploadError = (error: Error) => {
    console.error('Upload error:', error);
    // Error state is handled within the component
  };

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
        <ResumeUploadComponent
          onUploadComplete={handleUploadComplete}
          onUploadError={handleUploadError}
        />
      </div>
    </div>
  );
}
