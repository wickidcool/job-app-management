import type { ApplicationStatus } from '../types/application';

type StatusBadgeSize = 'sm' | 'md' | 'lg';
type StatusBadgeVariant = 'filled' | 'outlined' | 'dot';

export interface StatusBadgeProps {
  status: ApplicationStatus;
  size?: StatusBadgeSize;
  variant?: StatusBadgeVariant;
  showIcon?: boolean;
}

/**
 * StatusBadge Component
 * Visual indicator for application status with consistent color coding
 */
export function StatusBadge({
  status,
  size = 'md',
  variant = 'filled',
  showIcon = false,
}: StatusBadgeProps) {
  // Status configuration mapping
  const statusConfig: Record<
    ApplicationStatus,
    {
      label: string;
      icon: string;
      colorClasses: {
        filled: string;
        outlined: string;
        dot: string;
      };
    }
  > = {
    saved: {
      label: 'Saved',
      icon: '🔵',
      colorClasses: {
        filled: 'bg-info-100 text-info-700 border-info-100',
        outlined: 'bg-transparent text-info-700 border-info-700',
        dot: 'text-neutral-700',
      },
    },
    applied: {
      label: 'Applied',
      icon: '🟡',
      colorClasses: {
        filled: 'bg-warning-100 text-warning-700 border-warning-100',
        outlined: 'bg-transparent text-warning-700 border-warning-700',
        dot: 'text-neutral-700',
      },
    },
    phone_screen: {
      label: 'Phone Screen',
      icon: '🟠',
      colorClasses: {
        filled: 'bg-orange-100 text-orange-700 border-orange-100',
        outlined: 'bg-transparent text-orange-700 border-orange-700',
        dot: 'text-neutral-700',
      },
    },
    interview: {
      label: 'Interview',
      icon: '🟣',
      colorClasses: {
        filled: 'bg-purple-100 text-purple-700 border-purple-100',
        outlined: 'bg-transparent text-purple-700 border-purple-700',
        dot: 'text-neutral-700',
      },
    },
    offer: {
      label: 'Offer',
      icon: '🟢',
      colorClasses: {
        filled: 'bg-success-100 text-success-700 border-success-100',
        outlined: 'bg-transparent text-success-700 border-success-700',
        dot: 'text-neutral-700',
      },
    },
    rejected: {
      label: 'Rejected',
      icon: '🔴',
      colorClasses: {
        filled: 'bg-error-100 text-error-700 border-error-100',
        outlined: 'bg-transparent text-error-700 border-error-700',
        dot: 'text-neutral-700',
      },
    },
    withdrawn: {
      label: 'Withdrawn',
      icon: '⚪',
      colorClasses: {
        filled: 'bg-neutral-100 text-neutral-700 border-neutral-100',
        outlined: 'bg-transparent text-neutral-700 border-neutral-700',
        dot: 'text-neutral-700',
      },
    },
  };

  // Size configuration
  const sizeClasses: Record<StatusBadgeSize, string> = {
    sm: 'px-2 py-0.5 text-[12px] rounded-xl',
    md: 'px-3 py-1 text-[14px] rounded-2xl',
    lg: 'px-4 py-1.5 text-base rounded-2xl',
  };

  const iconSizes: Record<StatusBadgeSize, string> = {
    sm: 'text-[12px]',
    md: 'text-[16px]',
    lg: 'text-[20px]',
  };

  const dotSizes: Record<StatusBadgeSize, string> = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  const config = statusConfig[status];
  const colorClass = config.colorClasses[variant];

  // Dot variant renders differently
  if (variant === 'dot') {
    return (
      <div
        className="inline-flex items-center gap-2"
        role="status"
        aria-label={`Application status: ${config.label}`}
      >
        <span
          className={`rounded-full ${dotSizes[size]}`}
          style={{
            backgroundColor: getDotColor(status),
          }}
          aria-hidden="true"
        />
        <span className={`${colorClass} font-medium`}>{config.label}</span>
      </div>
    );
  }

  // Filled and Outlined variants
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium border ${sizeClasses[size]} ${colorClass} transition-colors duration-200`}
      role="status"
      aria-label={`Application status: ${config.label}`}
    >
      {showIcon && (
        <span className={iconSizes[size]} aria-hidden="true">
          {config.icon}
        </span>
      )}
      <span>{config.label}</span>
    </span>
  );
}

/**
 * Helper function to get dot color based on status
 */
function getDotColor(status: ApplicationStatus): string {
  const dotColors: Record<ApplicationStatus, string> = {
    saved: '#06b6d4', // cyan
    applied: '#eab308', // yellow
    phone_screen: '#f97316', // orange
    interview: '#a855f7', // purple
    offer: '#22c55e', // green
    rejected: '#ef4444', // red
    withdrawn: '#9ca3af', // gray
  };
  return dotColors[status];
}
