import { type ReactNode } from 'react';

export interface WizardButtonProps {
  variant: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  children: ReactNode;
  onClick: () => void;
  type?: 'button' | 'submit';
  'aria-label'?: string;
}

/**
 * WizardButton Component
 * Primary and secondary action buttons with clear visual states per design spec
 */
export function WizardButton({
  variant,
  disabled = false,
  loading = false,
  children,
  onClick,
  type = 'button',
  'aria-label': ariaLabel,
}: WizardButtonProps) {
  const getVariantClasses = () => {
    const baseClasses = 'inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-base focus:outline-none';

    switch (variant) {
      case 'primary':
        return `${baseClasses} px-6 py-3 text-base min-w-[120px] ${
          disabled
            ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed'
            : 'bg-primary-600 text-white shadow-sm hover:bg-primary-700 hover:shadow-md focus:ring-2 focus:ring-primary-500'
        }`;

      case 'secondary':
        return `${baseClasses} px-6 py-3 text-base min-w-[120px] ${
          disabled
            ? 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed'
            : 'bg-white text-neutral-700 border border-neutral-300 shadow-sm hover:bg-neutral-50 hover:border-neutral-400 hover:text-neutral-900 hover:shadow-md focus:ring-2 focus:ring-primary-500'
        }`;

      case 'ghost':
        return `${baseClasses} px-4 py-2 text-sm font-medium ${
          disabled
            ? 'bg-transparent text-neutral-400 cursor-not-allowed'
            : 'bg-transparent text-primary-600 hover:bg-primary-50 hover:text-primary-700 focus:ring-2 focus:ring-primary-500'
        }`;

      default:
        return baseClasses;
    }
  };

  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={getVariantClasses()}
      aria-disabled={isDisabled}
      aria-busy={loading}
      aria-label={ariaLabel}
    >
      {loading ? (
        <>
          <svg
            className="mr-2 h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
