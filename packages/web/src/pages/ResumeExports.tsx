import { Breadcrumb } from '../components/Breadcrumb';
import { ResumeManagerTabs } from '../components/ResumeManagerTabs';
import { EmptyState } from '../components/EmptyState';

export function ResumeExports() {
  const breadcrumbTrail = [
    { label: 'Dashboard', href: '/', icon: '🏠' },
    { label: 'Resume Manager', href: '/resumes' },
    { label: 'Exports' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">
            Resume Exports
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Tailored resume versions for specific job applications
          </p>
        </div>
        <button className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
          + Create New
        </button>
      </div>

      <ResumeManagerTabs />

      <div className="mt-8">
        <EmptyState
          variant="no-documents"
          onAction={() => (window.location.href = '/resumes/exports/new')}
          actionLabel="Create Your First Export"
        />
      </div>
    </div>
  );
}
