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
  if (trail.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center gap-2 text-sm">
        {trail.map((item, index) => {
          const isLast = index === trail.length - 1;

          return (
            <li key={index} className="flex items-center gap-2">
              {index > 0 && (
                <span className="text-neutral-400" aria-hidden="true">
                  /
                </span>
              )}
              {isLast || !item.href ? (
                <span className="flex items-center gap-1.5 text-neutral-900">
                  {item.icon && <span aria-hidden="true">{item.icon}</span>}
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.href}
                  className="flex items-center gap-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  {item.icon && <span aria-hidden="true">{item.icon}</span>}
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
