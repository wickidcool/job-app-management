import { Link, matchPath, useLocation } from 'react-router-dom';

interface Tab {
  id: string;
  label: string;
  // Navigation target for the tab's link.
  path: string;
  // Route patterns that light this tab. A tab is current when the location
  // matches any of them exactly (matchPath is end-anchored), so `/resumes`
  // stays exclusive to Master Resumes instead of prefixing every sub-route,
  // and Exports covers both its bare route and the parameterized one.
  match: string[];
}

const tabs: Tab[] = [
  { id: 'master', label: 'Master Resumes', path: '/resumes', match: ['/resumes'] },
  {
    id: 'exports',
    label: 'Exports',
    path: '/resumes/exports',
    match: ['/resumes/exports', '/resumes/:resumeId/exports'],
  },
  { id: 'upload', label: 'Upload New', path: '/resumes/upload', match: ['/resumes/upload'] },
];

export function ResumeManagerTabs() {
  const location = useLocation();

  const isActive = (tab: Tab) =>
    tab.match.some((pattern) => matchPath(pattern, location.pathname) !== null);

  return (
    <div className="border-b border-neutral-200 -mx-4 px-4 overflow-x-auto sm:mx-0 sm:px-0 sm:overflow-visible">
      <nav
        className="-mb-px flex gap-4 sm:gap-6 min-w-max sm:min-w-0"
        aria-label="Resume Manager tabs"
      >
        {tabs.map((tab) => {
          const active = isActive(tab);
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={`border-b-2 pb-3 pt-4 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
