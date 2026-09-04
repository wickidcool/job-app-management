import { formatDistanceToNow } from 'date-fns';
import type { ResumeVariantSummary } from '../services/api/types';

export interface ResumeVariantCardProps {
  variant: ResumeVariantSummary;
  onCardClick?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function ResumeVariantCard({ variant, onCardClick, onDelete }: ResumeVariantCardProps) {
  const handleClick = () => {
    onCardClick?.(variant.id);
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this resume variant?')) {
      onDelete?.(variant.id);
    }
  };

  const relativeTime = formatDistanceToNow(new Date(variant.createdAt), { addSuffix: true });

  const statusColors = {
    draft: 'bg-yellow-100 text-yellow-800',
    finalized: 'bg-green-100 text-green-800',
  };

  const formatLabels = {
    chronological: 'Chronological',
    functional: 'Functional',
    hybrid: 'Hybrid',
  };

  return (
    // The card is a plain <article>. It used to carry `role="button"` with its own
    // tabIndex/onKeyDown, which broke two ARIA rules at once: <article> is a
    // non-interactive element that may not take an interactive role
    // (`aria-allowed-role`), and the role made a widget that still contained the two
    // real buttons below (`nested-interactive`). Navigation now hangs off the title
    // button, which is reachable by mouse and keyboard alike without either problem.
    <article
      className="relative rounded-lg border border-gray-200 p-4 shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
      aria-label={`Resume variant: ${variant.title}`}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {/* h2: the card list is a direct child of the /resume-variants page h1, and this
                component has exactly one call site (WIC-1675 AC-2). The button inside it is
                the card's primary action — a heading may contain one, where the heading
                itself may not become one. */}
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              <button
                type="button"
                onClick={handleClick}
                className="w-full truncate text-left rounded hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {variant.title}
              </button>
            </h2>
            <p className="text-sm text-gray-600">
              {variant.targetRole} at {variant.targetCompany}
            </p>
          </div>
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[variant.status]}`}
          >
            {variant.status}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <svg
              className="w-4 h-4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {formatLabels[variant.format]}
          </span>

          {variant.atsScore !== undefined && (
            <span className="flex items-center gap-1">
              <svg
                className="w-4 h-4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 00-2-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              ATS: {variant.atsScore}%
            </span>
          )}

          <span className="ml-auto">{relativeTime}</span>
        </div>

        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={handleClick}
            className="flex-1 px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
          >
            View & Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 rounded hover:bg-red-100 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
