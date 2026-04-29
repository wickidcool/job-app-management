import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Application } from '../types/application';
import { ApplicationCard } from './ApplicationCard';
import { SwipeableCard, type SwipeAction } from './SwipeableCard';
import { useState, useEffect } from 'react';

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

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const leftActions: SwipeAction[] = [
    {
      icon: '🗑️',
      label: 'Delete',
      color: 'bg-error-500 hover:bg-error-600',
      action: () => onDelete?.(application.id),
    },
  ];

  const cardContent = (
    <ApplicationCard
      application={application}
      variant="kanban"
      draggable={!isMobile}
      showQuickActions={!isMobile}
      onCardClick={onCardClick}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );

  if (isMobile) {
    return (
      <div ref={setNodeRef} style={style}>
        <SwipeableCard
          leftActions={leftActions}
        >
          {cardContent}
        </SwipeableCard>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {cardContent}
    </div>
  );
}
