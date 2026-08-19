type EmptyStateVariant = 'no-applications' | 'no-results' | 'no-documents';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  onAction?: () => void;
  actionLabel?: string;
}

/**
 * EmptyState Component
 * Friendly message when no data is available
 */
export function EmptyState({ variant, onAction, actionLabel }: EmptyStateProps) {
  // Variant configuration
  const variantConfig: Record<
    EmptyStateVariant,
    {
      icon: string;
      heading: string;
      message: string;
      defaultActionLabel: string;
    }
  > = {
    'no-applications': {
      icon: '📋',
      heading: 'No applications yet!',
      message:
        'Track your job applications in one place. Start by adding your first application to get organized.',
      defaultActionLabel: 'Add Your First Application',
    },
    'no-results': {
      icon: '🔍',
      heading: 'No matching results',
      message: "Try adjusting your filters or search terms to find what you're looking for.",
      defaultActionLabel: 'Clear Filters',
    },
    'no-documents': {
      icon: '📄',
      heading: 'No documents found',
      message: 'Generate a cover letter to get started with your application materials.',
      defaultActionLabel: 'Create Cover Letter',
    },
  };

  const config = variantConfig[variant];
  const buttonLabel = actionLabel || config.defaultActionLabel;

  return (
    // No aria-live here: this content is static per `variant` and never updates
    // in place, so a live region buys nothing — and it costs correctness. The
    // aria-hidden package Radix uses to hide the background behind a modal
    // deliberately exempts [aria-live] elements, which keeps the exempt node,
    // all of its descendants and its whole ancestor chain reachable to the
    // screen reader. Because this container wraps the action button, that left
    // a live control exposed behind every open dialog. If a variant ever needs
    // to announce a *change* (e.g. "No matching results" after a filter edit),
    // the live region belongs on the results container that swaps between
    // states, not on the empty state itself.
    <div
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
      role="region"
      aria-label="Empty state"
    >
      {/* Icon */}
      <div className="text-6xl mb-4 opacity-50" aria-hidden="true">
        {config.icon}
      </div>

      {/* Heading */}
      <h3 className="text-h4 text-neutral-800 mb-2 font-semibold">{config.heading}</h3>

      {/* Message */}
      <p className="text-body text-neutral-600 max-w-md mb-6">{config.message}</p>

      {/* Action Button */}
      {onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center justify-center px-6 py-3
                   bg-primary-600 hover:bg-primary-700
                   text-white font-medium rounded-lg
                   transition-colors duration-200
                   focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          type="button"
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
