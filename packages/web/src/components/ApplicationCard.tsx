import { formatDistanceToNow, differenceInDays, parseISO, startOfDay } from 'date-fns';
import type { Application, ApplicationStatus } from '../types/application';
import { useState, useMemo } from 'react';

function getUrgencyIndicators(application: Application): {
  isOverdue: boolean;
  isDueSoon: boolean;
  isStale: boolean;
} {
  const today = startOfDay(new Date());
  let isOverdue = false;
  let isDueSoon = false;

  if (application.nextActionDue) {
    const dueDate = startOfDay(parseISO(application.nextActionDue));
    const daysUntilDue = differenceInDays(dueDate, today);
    isOverdue = daysUntilDue < 0;
    isDueSoon = !isOverdue && daysUntilDue <= 3;
  }

  const daysSinceUpdate = differenceInDays(today, new Date(application.updatedAt));
  const isStale = daysSinceUpdate >= 14;

  return { isOverdue, isDueSoon, isStale };
}

export interface ApplicationCardProps {
  application: Application;
  variant?: 'kanban' | 'list';
  draggable?: boolean;
  showQuickActions?: boolean;
  onCardClick?: (id: string) => void;
  onStatusChange?: (id: string, newStatus: ApplicationStatus) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function ApplicationCard({
  application,
  variant = 'kanban',
  draggable = false,
  showQuickActions = true,
  onCardClick,
  onEdit,
  onDelete,
}: ApplicationCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const { isOverdue, isDueSoon, isStale } = useMemo(
    () => getUrgencyIndicators(application),
    [application]
  );

  const handleClick = () => {
    onCardClick?.(application.id);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(application.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this application?')) {
      onDelete?.(application.id);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify(application));
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const relativeTime = formatDistanceToNow(application.createdAt, { addSuffix: true });

  const showActionsBar = showQuickActions && isHovered;

  const cardClasses = `
    relative rounded-lg border p-4 transition-all cursor-pointer
    ${isDragging ? 'opacity-50 rotate-2 shadow-lg' : 'shadow-sm'}
    ${isHovered ? 'border-blue-300 shadow-md' : 'border-gray-200'}
    ${variant === 'list' ? 'flex items-center gap-4' : 'flex flex-col gap-2'}
    ${showActionsBar ? 'pb-16' : ''}
    hover:border-blue-300 hover:shadow-md
    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
  `;

  const ariaLabel = `${application.jobTitle} at ${application.company}, status: ${application.status}`;

  return (
    <article
      className={cardClasses}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="article"
      aria-label={ariaLabel}
    >
      {/* Company Icon Placeholder */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-xl">
            💼
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {/* Job Title */}
          <h3 className="text-lg font-semibold truncate text-gray-900">{application.jobTitle}</h3>

          {/* Company Name */}
          <p className="text-sm text-gray-600 truncate">{application.company}</p>

          {/* Location and Salary */}
          {(application.location || application.salaryRange) && (
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              {application.location && <span>{application.location}</span>}
              {application.location && application.salaryRange && <span>|</span>}
              {application.salaryRange && <span>{application.salaryRange}</span>}
            </div>
          )}

          {/* Document Count */}
          {application.hasDocuments && (
            <div className="mt-2 text-xs text-gray-500">
              <span>📎 Has documents</span>
            </div>
          )}

          {/* Urgency Indicators */}
          {(isOverdue || isDueSoon || isStale) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {isOverdue && (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  Overdue
                </span>
              )}
              {isDueSoon && (
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                  Due soon
                </span>
              )}
              {isStale && (
                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                  Stale
                </span>
              )}
            </div>
          )}

          {/* Next Action */}
          {application.nextAction && (
            <p className="mt-1 text-xs text-gray-600 truncate">
              <span className="font-medium">Next:</span> {application.nextAction}
            </p>
          )}

          {/* Relative Time */}
          <div className="mt-2 text-xs text-gray-400 text-right">{relativeTime}</div>
        </div>
      </div>

      {/* Quick Actions (shown on hover) - Touch-optimized */}
      {showActionsBar && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 rounded-b-lg p-2 flex items-center justify-between gap-2">
          <button
            onClick={handleEdit}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-4 py-3 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            aria-label={`Edit ${application.jobTitle}`}
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-4 py-3 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            aria-label={`Delete ${application.jobTitle}`}
          >
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
