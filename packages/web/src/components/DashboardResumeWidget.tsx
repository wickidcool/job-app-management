import { Link } from 'react-router-dom';

interface DashboardResumeWidgetProps {
  masterResumeCount?: number;
  exportCount?: number;
  loading?: boolean;
}

export function DashboardResumeWidget({
  masterResumeCount = 0,
  exportCount = 0,
  loading = false,
}: DashboardResumeWidgetProps) {
  const hasResumes = masterResumeCount > 0 || exportCount > 0;

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📄</span>
            <h2 className="text-lg font-semibold text-neutral-900">
              Your Resumes
            </h2>
          </div>
          <span className="text-neutral-400">→</span>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-neutral-200" />
          <div className="h-4 w-24 rounded bg-neutral-200" />
        </div>
      </div>
    );
  }

  if (!hasResumes) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📄</span>
            <h2 className="text-lg font-semibold text-neutral-900">
              Your Resumes
            </h2>
          </div>
          <Link
            to="/resumes"
            className="text-sm text-primary-600 hover:text-primary-700"
            aria-label="Go to Resume Manager"
          >
            →
          </Link>
        </div>

        <div className="mb-4 text-center">
          <div className="mb-2 text-4xl">📋</div>
          <p className="text-sm text-neutral-600">No resumes yet</p>
          <p className="mt-1 text-xs text-neutral-500">
            Upload your resume to create tailored versions for each job
          </p>
        </div>

        <Link
          to="/resumes/upload"
          className="block w-full rounded-lg bg-primary-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-700"
        >
          Upload Your First Resume
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📄</span>
          <h2 className="text-lg font-semibold text-neutral-900">
            Your Resumes
          </h2>
        </div>
        <Link
          to="/resumes"
          className="text-sm text-primary-600 hover:text-primary-700"
          aria-label="Go to Resume Manager"
        >
          →
        </Link>
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-600">Master resumes:</span>
          <span className="font-semibold text-neutral-900">
            {masterResumeCount}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-600">Exports:</span>
          <span className="font-semibold text-neutral-900">{exportCount}</span>
        </div>
      </div>

      <Link
        to="/resumes/upload"
        className="block w-full rounded-lg border border-primary-600 px-4 py-2 text-center text-sm font-medium text-primary-600 hover:bg-primary-50"
      >
        Upload New Resume
      </Link>
    </div>
  );
}
