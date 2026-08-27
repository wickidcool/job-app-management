type EmptyStateVariant = 'no-applications' | 'no-results' | 'no-documents';

/**
 * Semantic depth for this component's heading. `1` is deliberately excluded: the
 * page `<h1>` names the route, and an empty state is never the route.
 */
export type EmptyStateHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  onAction?: () => void;
  actionLabel?: string;
  /**
   * The heading level this instance should render at, so the host page's outline
   * stays gap-free. Defaults to `2`, which is correct when the empty state is the
   * direct content of a page under its `<h1>` — all current call sites. Pass the
   * real depth when nesting it under a section that already has its own heading
   * (a card, a tab panel, a `<section>` with an `<h2>`); a skipped level breaks
   * the outline screen-reader users navigate by.
   *
   * The rendered size does not change with the level — see the note on the
   * heading below.
   */
  headingLevel?: EmptyStateHeadingLevel;
}

/**
 * EmptyState Component
 * Friendly message when no data is available
 */
export function EmptyState({ variant, onAction, actionLabel, headingLevel = 2 }: EmptyStateProps) {
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
  const Heading = `h${headingLevel}` as `h${EmptyStateHeadingLevel}`;

  return (
    // This wrapper is deliberately a plain <div> with no ARIA. Three attributes
    // were removed here; each was doing harm rather than nothing.
    //
    // No aria-live: this content is static per `variant` and never updates in
    // place, so a live region buys nothing — and it costs correctness. The
    // aria-hidden package Radix uses to hide the background behind a modal
    // deliberately exempts [aria-live] elements, which keeps the exempt node,
    // all of its descendants and its whole ancestor chain reachable to the
    // screen reader. Because this container wraps the action button, that left
    // a live control exposed behind every open dialog. If a variant ever needs
    // to announce a *change* (e.g. "No matching results" after a filter edit),
    // the live region belongs on the results container that swaps between
    // states, not on the empty state itself.
    //
    // No role="region"/aria-label: a region is a navigable landmark, and this
    // block — an icon, a heading, one sentence and at most one button — is not
    // a major structural area. It is also the only thing inside <main> when it
    // renders, so it added a second landmark wrapping the sole contents of the
    // first. The heading below is the real entry point, and "No documents found"
    // names this content far better than "Empty state", which was our component
    // name leaking into the accessibility tree. The two had to go together in
    // any case: aria-label on a role-less <div> maps to `generic`, which does
    // not support an accessible name, so keeping it would have left a dead
    // attribute that axe flags as aria-prohibited-attr.
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {/* Icon */}
      <div className="text-6xl mb-4 opacity-50" aria-hidden="true">
        {config.icon}
      </div>

      {/* Heading.
          The tag comes from `headingLevel`; the size does not. `text-h4` is a type
          token and stays pinned at every level, because the semantic depth of this
          block depends on where the host page renders it and its visual weight does
          not. Keeping the two decoupled is the point — the tag was hardcoded to
          <h3> precisely because it was standing in for the size (WIC-1417). */}
      <Heading className="text-h4 text-neutral-800 mb-2 font-semibold">{config.heading}</Heading>

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
