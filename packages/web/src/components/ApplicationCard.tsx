import { formatDistanceToNow } from 'date-fns';
import type { Application, ApplicationStatus } from '../types/application';
import { useState } from 'react';

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

  const cardClasses = `
    relative rounded-lg border p-4 transition-all cursor-pointer
    ${isDragging ? 'opacity-50 rotate-2 shadow-lg' : 'shadow-sm'}
    ${isHovered ? 'border-blue-300 shadow-md' : 'border-gray-200'}
    ${variant === 'list' ? 'flex items-center gap-4' : 'flex flex-col gap-2'}
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

          {/* Relative Time */}
          <div className="mt-2 text-xs text-gray-400 text-right">{relativeTime}</div>
        </div>
      </div>

      {/* Quick Actions (shown on hover) */}
      {showQuickActions && isHovered && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 rounded-b-lg p-2 flex items-center justify-between gap-2">
          <button
            onClick={handleEdit}
            className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
            aria-label={`Edit ${application.jobTitle}`}
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
            aria-label={`Delete ${application.jobTitle}`}
          >
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
