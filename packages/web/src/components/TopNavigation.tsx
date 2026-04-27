import { Link, useLocation } from 'react-router-dom';

interface NavTab {
  label: string;
  path: string;
  badge?: number;
}

interface TopNavigationProps {
  applicationCount?: number;
  exportCount?: number;
}

export function TopNavigation({
  applicationCount,
  exportCount,
}: TopNavigationProps) {
  const location = useLocation();

  const tabs: NavTab[] = [
    { label: 'Dashboard', path: '/' },
    {
      label: 'Applications',
      path: '/applications',
      badge: applicationCount,
    },
    { label: 'Reports', path: '/reports' },
    {
      label: 'Resume Manager',
      path: '/resumes',
      badge: exportCount,
    },
    { label: 'Catalog', path: '/catalog' },
    { label: 'Projects', path: '/projects' },
    { label: 'Settings', path: '/settings' },
  ];

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <span className="text-xl">📋</span>
              <span className="text-lg font-semibold text-neutral-900">
                Job App Manager
              </span>
            </div>

            <div className="hidden md:flex md:gap-6" role="tablist">
              {tabs.map((tab) => (
                <Link
                  key={tab.path}
                  to={tab.path}
                  role="tab"
                  aria-current={isActive(tab.path) ? 'page' : undefined}
                  className={`relative pb-4 pt-5 text-sm font-medium transition-colors ${
                    isActive(tab.path)
                      ? 'border-b-2 border-primary-500 font-bold text-primary-600'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {tab.label}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
                      {tab.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-200"
              aria-label="User menu"
            >
              <span className="text-base">👤</span>
              <span className="hidden sm:inline">User</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
