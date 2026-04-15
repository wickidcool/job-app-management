import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Application, ApplicationStatus } from '../types/application';
import { SortableApplicationCard } from './SortableApplicationCard';

interface ColumnConfig {
  id: ApplicationStatus;
  title: string;
  color: string;
  icon: string;
}

export interface KanbanColumnProps {
  column: ColumnConfig;
  applications: Application[];
  isOver: boolean;
  onCardClick?: (appId: string) => void;
  onEdit?: (appId: string) => void;
  onDelete?: (appId: string) => void;
}

const colorClasses: Record<string, string> = {
  blue: 'border-blue-200 bg-blue-50/50',
  yellow: 'border-yellow-200 bg-yellow-50/50',
  orange: 'border-orange-200 bg-orange-50/50',
  purple: 'border-purple-200 bg-purple-50/50',
  green: 'border-green-200 bg-green-50/50',
  red: 'border-red-200 bg-red-50/50',
};

export function KanbanColumn({
  column,
  applications,
  isOver,
  onCardClick,
  onEdit,
  onDelete,
}: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id: column.id,
  });

  const applicationIds = applications.map((app) => app.id);

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col min-h-[500px] rounded-lg border-2 transition-all
        ${isOver ? 'border-dashed bg-blue-50 border-blue-400' : colorClasses[column.color] || 'border-gray-200 bg-gray-50'}
      `}
    >
      {/* Column Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{column.icon}</span>
          <h3 className="font-semibold text-gray-900">{column.title}</h3>
        </div>
        <span className="text-sm font-medium text-gray-500 bg-white px-2 py-0.5 rounded-full">
          {applications.length}
        </span>
      </div>

      {/* Column Content */}
      <div className="flex-1 p-3 overflow-y-auto max-h-[600px]">
        {applications.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No {column.title.toLowerCase()} applications
          </div>
        ) : (
          <SortableContext items={applicationIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {applications.map((application) => (
                <SortableApplicationCard
                  key={application.id}
                  application={application}
                  onCardClick={onCardClick}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
}
