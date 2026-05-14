import { Link, useLocation } from 'react-router-dom';

interface Tab {
  id: string;
  label: string;
  path: string;
}

const tabs: Tab[] = [
  { id: 'master', label: 'Master Resumes', path: '/resumes' },
  { id: 'exports', label: 'Exports', path: '/resumes/exports' },
  { id: 'upload', label: 'Upload New', path: '/resumes/upload' },
];

export function ResumeManagerTabs() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/resumes') {
      return location.pathname === '/resumes';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="border-b border-neutral-200 -mx-4 px-4 overflow-x-auto sm:mx-0 sm:px-0 sm:overflow-visible">
      <nav
        className="-mb-px flex gap-4 sm:gap-6 min-w-max sm:min-w-0"
        aria-label="Resume Manager tabs"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.path}
            className={`border-b-2 pb-3 pt-4 text-sm font-medium transition-colors ${
              isActive(tab.path)
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900'
            }`}
            aria-current={isActive(tab.path) ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
