import type { CatalogChangeAction } from '../../types/catalog';

interface ChangeActionBadgeProps {
  action: CatalogChangeAction;
  size?: 'sm' | 'md' | 'lg';
}

const actionConfig = {
  create: {
    bgColor: 'bg-success-50',
    textColor: 'text-success-700',
    label: 'CREATE',
    icon: '➕',
  },
  update: {
    bgColor: 'bg-info-50',
    textColor: 'text-info-700',
    label: 'UPDATE',
    icon: '✏️',
  },
  delete: {
    bgColor: 'bg-error-50',
    textColor: 'text-error-700',
    label: 'DELETE',
    icon: '🗑️',
  },
} as const;

const sizeConfig = {
  sm: 'h-5 text-xs px-1',
  md: 'h-6 text-sm px-1.5',
  lg: 'h-7 text-body px-2',
} as const;

export function ChangeActionBadge({ action, size = 'md' }: ChangeActionBadgeProps) {
  const config = actionConfig[action];
  const sizeClass = sizeConfig[size];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium ${config.bgColor} ${config.textColor} ${sizeClass}`}
      aria-label={`${config.label} action`}
    >
      <span aria-hidden="true">{config.icon}</span>
      {config.label}
    </span>
  );
}
