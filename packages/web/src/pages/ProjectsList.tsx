import { Link } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { EmptyState } from '../components/EmptyState';
import { useProjects } from '../hooks/useProjects';

export function ProjectsList() {
  const { data: projects = [], isLoading } = useProjects();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 animate-pulse">
          <div className="mb-2 h-8 w-48 rounded bg-neutral-200"></div>
          <div className="h-4 w-96 rounded bg-neutral-200"></div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-neutral-200"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Projects', href: '/projects' },
        ]}
      />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Projects</h1>
        <p className="mt-2 text-sm text-neutral-600">
          View and manage project markdown files generated from your resume
        </p>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          variant="no-documents"
          onAction={() => {
            window.location.href = '/resume-manager';
          }}
          actionLabel="Upload Resume"
        />
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="block rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-neutral-900">{project.name}</h3>
                  <p className="mt-1 text-sm text-neutral-600">
                    {project.fileCount} {project.fileCount === 1 ? 'file' : 'files'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-neutral-400">
                    Updated {project.updatedAt.toLocaleDateString()}
                  </span>
                  <svg
                    className="h-5 w-5 text-neutral-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
