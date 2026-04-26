import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface MobileNavigationProps {
  applicationCount?: number;
  exportCount?: number;
}

export function MobileNavigation({ applicationCount, exportCount }: MobileNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  const navItems = [
    { icon: '📋', label: 'Dashboard', path: '/' },
    {
      icon: '💼',
      label: 'Applications',
      path: '/applications',
      badge: applicationCount,
    },
    {
      icon: '📄',
      label: 'Resume Manager',
      path: '/resumes',
      badge: exportCount,
      isNew: true,
    },
    { icon: '📚', label: 'Catalog', path: '/catalog' },
    { icon: '🔍', label: 'Job Fit Analysis', path: '/job-fit-analysis' },
    { icon: '📁', label: 'Projects', path: '/projects' },
    { icon: '⚙️', label: 'Settings', path: '/settings' },
  ];

  const quickActions = [
    { label: 'Upload Resume', path: '/resumes/upload' },
    { label: 'Add Application', path: '/applications/new' },
  ];

  return (
    <div className="md:hidden">
      <div className="flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-4">
        <button
          onClick={toggleMenu}
          className="text-2xl"
          aria-label="Toggle menu"
          aria-expanded={isOpen}
        >
          ☰
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xl">📋</span>
          <span className="text-base font-semibold text-neutral-900">Job App Manager</span>
        </div>

        <button className="rounded-full bg-neutral-100 p-2 text-base" aria-label="User menu">
          👤
        </button>
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={closeMenu} aria-hidden="true" />

          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-neutral-200 p-4">
                <span className="text-lg font-semibold">Menu</span>
                <button
                  onClick={closeMenu}
                  className="text-2xl text-neutral-500 hover:text-neutral-700"
                  aria-label="Close menu"
                >
                  ✕
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto p-4">
                <ul className="space-y-2">
                  {navItems.map((item) => (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        onClick={closeMenu}
                        className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                          location.pathname === item.path ||
                          (item.path !== '/' && location.pathname.startsWith(item.path))
                            ? 'bg-primary-50 text-primary-600'
                            : 'text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{item.icon}</span>
                          <span className="font-medium">{item.label}</span>
                        </div>
                        {item.isNew && (
                          <span className="rounded-full bg-primary-500 px-2 py-0.5 text-xs font-medium text-white">
                            NEW
                          </span>
                        )}
                        {item.badge !== undefined && item.badge > 0 && (
                          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 border-t border-neutral-200 pt-4">
                  <p className="mb-2 px-4 text-xs font-semibold uppercase text-neutral-500">
                    Quick Actions
                  </p>
                  <ul className="space-y-2">
                    {quickActions.map((action) => (
                      <li key={action.path}>
                        <Link
                          to={action.path}
                          onClick={closeMenu}
                          className="block rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                        >
                          {action.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </nav>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
