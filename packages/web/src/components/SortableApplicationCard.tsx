import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Application } from '../types/application';
import { ApplicationCard } from './ApplicationCard';

export interface SortableApplicationCardProps {
  application: Application;
  onCardClick?: (appId: string) => void;
  onEdit?: (appId: string) => void;
  onDelete?: (appId: string) => void;
}

export function SortableApplicationCard({
  application,
  onCardClick,
  onEdit,
  onDelete,
}: SortableApplicationCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: application.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ApplicationCard
        application={application}
        variant="kanban"
        draggable={true}
        showQuickActions={true}
        onCardClick={onCardClick}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}
