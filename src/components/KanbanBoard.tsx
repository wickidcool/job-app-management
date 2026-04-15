import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Application, ApplicationStatus } from '../types/application';
import { ApplicationCard } from './ApplicationCard';
import { KanbanColumn } from './KanbanColumn';

export interface KanbanBoardProps {
  applications: Application[];
  onStatusChange: (appId: string, newStatus: ApplicationStatus) => void;
  onCardClick: (appId: string) => void;
  onEdit?: (appId: string) => void;
  onDelete?: (appId: string) => void;
  loading?: boolean;
}

interface ColumnConfig {
  id: ApplicationStatus;
  title: string;
  color: string;
  icon: string;
}

const columns: ColumnConfig[] = [
  { id: 'saved', title: 'Saved', color: 'blue', icon: '📥' },
  { id: 'applied', title: 'Applied', color: 'yellow', icon: '📤' },
  { id: 'phone_screen', title: 'Phone Screen', color: 'orange', icon: '📞' },
  { id: 'interview', title: 'Interview', color: 'purple', icon: '🤝' },
  { id: 'offer', title: 'Offer', color: 'green', icon: '🎉' },
  { id: 'rejected', title: 'Rejected', color: 'red', icon: '❌' },
];

export function KanbanBoard({
  applications,
  onStatusChange,
  onCardClick,
  onEdit,
  onDelete,
  loading = false,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Group applications by status
  const applicationsByStatus = columns.reduce(
    (acc, column) => {
      acc[column.id] = applications.filter((app) => app.status === column.id);
      return acc;
    },
    {} as Record<ApplicationStatus, Application[]>
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    setOverId(over?.id as string | null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      setOverId(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find the application being dragged
    const activeApp = applications.find((app) => app.id === activeId);
    if (!activeApp) {
      setActiveId(null);
      setOverId(null);
      return;
    }

    // Check if dropped on a column
    const targetColumn = columns.find((col) => col.id === overId);
    if (targetColumn && targetColumn.id !== activeApp.status) {
      // Status change
      onStatusChange(activeId, targetColumn.id);

      // Announce to screen readers
      const announcement = `Moved ${activeApp.jobTitle} from ${activeApp.status} to ${targetColumn.id}`;
      announceToScreenReader(announcement);
    }

    setActiveId(null);
    setOverId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverId(null);
  };

  const activeApplication = activeId ? applications.find((app) => app.id === activeId) : null;

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {columns.map((column) => (
          <div key={column.id} className="bg-gray-50 rounded-lg p-4 h-96 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-24 mb-4"></div>
            <div className="space-y-3">
              <div className="h-32 bg-gray-200 rounded"></div>
              <div className="h-32 bg-gray-200 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="region" aria-label="Kanban board" className="w-full">
      {/* ARIA Live Region for announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" id="kanban-announcements" />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              applications={applicationsByStatus[column.id] || []}
              isOver={overId === column.id}
              onCardClick={onCardClick}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>

        <DragOverlay>
          {activeApplication ? (
            <div className="rotate-2 opacity-90">
              <ApplicationCard
                application={activeApplication}
                variant="kanban"
                draggable={false}
                showQuickActions={false}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// Helper function to announce to screen readers
function announceToScreenReader(message: string) {
  const liveRegion = document.getElementById('kanban-announcements');
  if (liveRegion) {
    liveRegion.textContent = message;
    // Clear after announcement
    setTimeout(() => {
      liveRegion.textContent = '';
    }, 1000);
  }
}
