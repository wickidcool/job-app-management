import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAuth } from '../contexts/AuthContext';

interface NavTab {
  label: string;
  path: string;
  badge?: number;
}

interface NavDropdown {
  label: string;
  items: NavTab[];
  badge?: number;
}

interface TopNavigationProps {
  applicationCount?: number;
  exportCount?: number;
}

export function TopNavigation({ applicationCount, exportCount }: TopNavigationProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const primaryTabs: NavTab[] = [
    { label: 'Dashboard', path: '/' },
    {
      label: 'Applications',
      path: '/applications',
      badge: applicationCount,
    },
    { label: 'Reports', path: '/reports' },
  ];

  const dropdowns: NavDropdown[] = [
    {
      label: 'Resumes',
      badge: exportCount,
      items: [
        { label: 'Resume Manager', path: '/resumes' },
        { label: 'Resume Variants', path: '/resume-variants' },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Catalog', path: '/catalog' },
        { label: 'Job Fit Analysis', path: '/job-fit-analysis' },
        { label: 'Projects', path: '/projects' },
      ],
    },
  ];

  const settingsTab: NavTab = { label: 'Settings', path: '/settings' };

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  const isDropdownActive = (items: NavTab[]) => {
    return items.some((item) => isActive(item.path));
  };

  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <span className="text-xl">📋</span>
              <span className="text-lg font-semibold text-neutral-900">Job App Manager</span>
            </div>

            <div className="hidden md:flex md:gap-6" role="tablist">
              {primaryTabs.map((tab) => (
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

              {dropdowns.map((dropdown) => (
                <DropdownMenu.Root key={dropdown.label}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      className={`relative flex items-center gap-1 pb-4 pt-5 text-sm font-medium transition-colors ${
                        isDropdownActive(dropdown.items)
                          ? 'border-b-2 border-primary-500 font-bold text-primary-600'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      {dropdown.label}
                      {dropdown.badge !== undefined && dropdown.badge > 0 && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
                          {dropdown.badge}
                        </span>
                      )}
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="min-w-[180px] rounded-md bg-white p-1 shadow-lg ring-1 ring-black ring-opacity-5"
                      sideOffset={5}
                    >
                      {dropdown.items.map((item) => (
                        <DropdownMenu.Item key={item.path} asChild>
                          <Link
                            to={item.path}
                            className={`block rounded px-3 py-2 text-sm outline-none transition-colors ${
                              isActive(item.path)
                                ? 'bg-primary-50 font-medium text-primary-600'
                                : 'text-neutral-700 hover:bg-neutral-100'
                            }`}
                          >
                            {item.label}
                          </Link>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ))}

              <Link
                to={settingsTab.path}
                role="tab"
                aria-current={isActive(settingsTab.path) ? 'page' : undefined}
                className={`relative pb-4 pt-5 text-sm font-medium transition-colors ${
                  isActive(settingsTab.path)
                    ? 'border-b-2 border-primary-500 font-bold text-primary-600'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {settingsTab.label}
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-200"
                  aria-label="User menu"
                >
                  <span className="text-base">👤</span>
                  <span className="hidden sm:inline">{user?.email || 'User'}</span>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[200px] rounded-md bg-white p-1 shadow-lg ring-1 ring-black ring-opacity-5"
                  sideOffset={5}
                  align="end"
                >
                  <div className="px-3 py-2 text-sm text-neutral-500 border-b border-neutral-100">
                    {user?.email}
                  </div>
                  <DropdownMenu.Item asChild>
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 outline-none cursor-pointer"
                    >
                      Sign Out
                    </button>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
    </nav>
  );
}
