import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { EmptyState } from '../components/EmptyState';
import { useProjectFiles } from '../hooks/useProjects';
import { DYNAMIC_TITLE_FALLBACKS } from '../constants/title';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * This route's top-level heading, rendered on the loading branch as well as the loaded one
 * (WIC-2050).
 *
 * The skeleton below used to stand a grey block where the heading goes, so the route
 * opened at no heading at all while the request was in flight — the WCAG 2.1 AA
 * (SC 1.3.1) defect `routeOutline.render.test.tsx` inventories. Nothing was waiting on
 * the response: the name comes off the URL, which is why `useDocumentTitle` above can
 * already resolve it before the first fetch settles. Only the file *count* needs the
 * data, so only that line keeps a skeleton.
 *
 * Extracted as a component rather than duplicated because `routeOutline.source.test.ts`
 * pins this file at exactly one literal `h1` — two copies of the same markup would read
 * there as the page growing a second top-level heading.
 */
function ProjectDetailHeading({ name, subtitle }: { name: string; subtitle: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold text-neutral-900">{name}</h1>
      <p className="mt-2 text-sm text-neutral-600">{subtitle}</p>
    </div>
  );
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: files = [], isLoading } = useProjectFiles(projectId!);

  const projectName = projectId ? decodeURIComponent(projectId).replace(/-/g, ' ') : '';

  // Mirrors the page <h1>. Must sit above the loading early-return below — a hook cannot
  // be called conditionally, and the loading render is exactly when the fallback matters.
  const heading = projectName || DYNAMIC_TITLE_FALLBACKS.project;
  useDocumentTitle(heading);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ProjectDetailHeading
          name={heading}
          subtitle={<span className="inline-block h-4 w-32 animate-pulse rounded bg-neutral-200" />}
        />
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
          { label: 'Dashboard', href: '/' },
          { label: 'Projects', href: '/projects' },
          { label: projectName, href: `/projects/${projectId}` },
        ]}
      />

      <ProjectDetailHeading
        name={heading}
        subtitle={`${files.length} ${files.length === 1 ? 'file' : 'files'} in this project`}
      />

      {files.length === 0 ? (
        <EmptyState
          variant="no-documents"
          onAction={() => {
            navigate('/resumes/upload');
          }}
          actionLabel="Upload Resume"
        />
      ) : (
        <div className="space-y-4">
          {files.map((file) => (
            <Link
              key={file.fileName}
              to={`/projects/${projectId}/files/${file.fileName}`}
              className="block rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📄</span>
                  <div>
                    <h2 className="font-semibold text-neutral-900">{file.fileName}</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-neutral-400">
                    Updated {file.updatedAt.toLocaleDateString()}
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
