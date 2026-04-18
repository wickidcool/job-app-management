import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { EmptyState } from '../components/EmptyState';

export function ResumeManager() {
  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager' },
  ];

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
        <EmptyState
          variant="no-documents"
          onAction={() => (window.location.href = '/resumes/upload')}
          actionLabel="Upload Your First Resume"
        />
      </div>
    </div>
  );
}
