import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: string;
}

interface BreadcrumbProps {
  trail: BreadcrumbItem[];
}

export function Breadcrumb({ trail }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      {trail.map((item, index) => {
        const isLast = index === trail.length - 1;

        return (
          <div key={index} className="flex items-center gap-2">
            {item.icon && <span className="text-base">{item.icon}</span>}
            {item.href && !isLast ? (
              <Link
                to={item.href}
                className="text-neutral-600 hover:text-primary-600 transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'font-medium text-neutral-900' : 'text-neutral-600'}>
                {item.label}
              </span>
            )}
            {!isLast && (
              <svg
                className="h-4 w-4 text-neutral-400"
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
            )}
          </div>
        );
      })}
    </nav>
  );
}
