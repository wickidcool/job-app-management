import { Link, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface TabItem {
  icon: string;
  label: string;
  path: string;
  badge?: number;
  dropdown?: { label: string; path: string }[];
}

interface BottomTabBarProps {
  applicationCount?: number;
  exportCount?: number;
}

export function BottomTabBar({ applicationCount, exportCount }: BottomTabBarProps) {
  const location = useLocation();

  const tabs: TabItem[] = [
    {
      icon: '🏠',
      label: 'Home',
      path: '/',
    },
    {
      icon: '💼',
      label: 'Apps',
      path: '/applications',
      badge: applicationCount,
    },
    {
      icon: '📄',
      label: 'Resumes',
      path: '/resumes',
      badge: exportCount,
      dropdown: [
        { label: 'Resume Manager', path: '/resumes' },
        { label: 'Resume Variants', path: '/resume-variants' },
        { label: 'Upload Resume', path: '/resumes/upload' },
      ],
    },
    {
      icon: '🔍',
      label: 'Tools',
      path: '/catalog',
      dropdown: [
        { label: 'Catalog', path: '/catalog' },
        { label: 'Job Fit Analysis', path: '/job-fit-analysis' },
        { label: 'Projects', path: '/projects' },
      ],
    },
    {
      icon: '⋯',
      label: 'More',
      path: '/settings',
      dropdown: [
        { label: 'Reports', path: '/reports' },
        { label: 'Settings', path: '/settings' },
      ],
    },
  ];

  const isActive = (path: string, dropdown?: { path: string }[]) => {
    if (path === '/' && location.pathname === '/') {
      return true;
    }
    if (path !== '/' && location.pathname.startsWith(path)) {
      return true;
    }
    if (dropdown) {
      return dropdown.some((item) => location.pathname.startsWith(item.path));
    }
    return false;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 bg-white md:hidden">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => (
          <div key={tab.path} className="flex-1">
            {tab.dropdown ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className={`flex w-full flex-col items-center gap-1 px-2 py-3 text-xs ${
                      isActive(tab.path, tab.dropdown) ? 'text-primary-600' : 'text-neutral-600'
                    }`}
                    style={{ minHeight: '56px' }}
                  >
                    <span className="relative text-xl">
                      {tab.icon}
                      {tab.badge !== undefined && tab.badge > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-error-500 text-[10px] font-medium text-white">
                          {tab.badge > 9 ? '9+' : tab.badge}
                        </span>
                      )}
                    </span>
                    <span className="font-medium">{tab.label}</span>
                  </button>
                </DropdownMenu.Trigger>

                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="mb-2 min-w-[180px] rounded-md bg-white p-1 shadow-lg ring-1 ring-black ring-opacity-5"
                    sideOffset={5}
                    align="center"
                  >
                    {tab.dropdown.map((item) => (
                      <DropdownMenu.Item key={item.path} asChild>
                        <Link
                          to={item.path}
                          className={`block rounded px-3 py-2 text-sm outline-none transition-colors ${
                            location.pathname.startsWith(item.path)
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
            ) : (
              <Link
                to={tab.path}
                className={`flex w-full flex-col items-center gap-1 px-2 py-3 text-xs ${
                  isActive(tab.path) ? 'text-primary-600' : 'text-neutral-600'
                }`}
                style={{ minHeight: '56px' }}
              >
                <span className="relative text-xl">
                  {tab.icon}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-error-500 text-[10px] font-medium text-white">
                      {tab.badge > 9 ? '9+' : tab.badge}
                    </span>
                  )}
                </span>
                <span className="font-medium">{tab.label}</span>
              </Link>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
