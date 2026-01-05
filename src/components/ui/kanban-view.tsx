"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ReactNode, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

export interface KanbanColumn<T extends string = string> {
  status: T;
  title: string;
  icon: ReactNode;
  color: string;
  bgColor: string;
}

interface DraggableItemProps {
  id: string;
  children: ReactNode | ((isDragging: boolean) => ReactNode);
  disabled?: boolean;
}

function DraggableItem({ id, children, disabled }: DraggableItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "touch-none",
        isDragging && "opacity-30",
        !disabled && !isDragging && "cursor-grab",
        isDragging && "cursor-grabbing"
      )}
      {...attributes}
      {...listeners}
    >
      {typeof children === "function" ? children(isDragging) : children}
    </div>
  );
}

interface DroppableColumnProps {
  id: string;
  children: ReactNode;
  className?: string;
}

function DroppableColumn({ id, children, className }: DroppableColumnProps) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
}

interface KanbanViewProps<T, S extends string> {
  items: T[];
  columns: KanbanColumn<S>[];
  getItemStatus: (item: T) => S;
  getItemId: (item: T) => string;
  renderCard: (item: T, isDragging?: boolean) => ReactNode;
  loading?: boolean;
  sortItems?: (a: T, b: T) => number;
  onStatusChange?: (itemId: string, newStatus: S) => Promise<void>;
  enableDragDrop?: boolean;
}

export function KanbanView<T, S extends string>({
  items,
  columns,
  getItemStatus,
  getItemId,
  renderCard,
  _loading,
  sortItems,
  onStatusChange,
  enableDragDrop = false,
}: KanbanViewProps<T, S>) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const itemsByStatus = items.reduce((acc, item) => {
    const status = getItemStatus(item);
    if (!acc[status]) {
      acc[status] = [];
    }
    acc[status].push(item);
    return acc;
  }, {} as Record<S, T[]>);

  if (sortItems) {
    Object.keys(itemsByStatus).forEach((status) => {
      itemsByStatus[status as S].sort(sortItems);
    });
  }

  // Setup sensors for drag and drop with activation constraint
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before dragging starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || !onStatusChange) return;

    const itemId = active.id as string;
    const newStatus = over.id as S;

    // Find the item's current status
    const item = items.find((i) => getItemId(i) === itemId);
    if (!item) return;

    const currentStatus = getItemStatus(item);

    // Only update if status changed
    if (currentStatus !== newStatus) {
      await onStatusChange(itemId, newStatus);
    }
  };

  const activeItem = activeId ? items.find((i) => getItemId(i) === activeId) : null;

  const content = (
    <div className="w-full">
      {/* Mobile view - stacked columns */}
      <div className="md:hidden space-y-4">
        {columns.map((column) => {
          const columnItems = itemsByStatus[column.status] || [];

          return (
            <div key={column.status} className="w-full">
              <div
                className={cn(
                  "rounded-t-lg px-4 py-3 border-x border-t",
                  column.bgColor,
                  "border-b-0"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className={cn("flex items-center gap-2 text-sm font-semibold", column.color)}>
                    {column.icon}
                    <span>{column.title}</span>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs font-medium px-2 py-0.5",
                      columnItems.length > 0 && "bg-background"
                    )}
                  >
                    {columnItems.length}
                  </Badge>
                </div>
              </div>
              <DroppableColumn
                id={column.status}
                className="bg-muted/20 rounded-b-lg border-x border-b p-3 space-y-2 min-h-[100px]"
              >
                {columnItems.length > 0 ? (
                  columnItems.map((item) =>
                    enableDragDrop ? (
                      <DraggableItem key={getItemId(item)} id={getItemId(item)}>
                        {(isDragging) => (
                          <div className="bg-background rounded-lg shadow-sm">
                            {renderCard(item, isDragging)}
                          </div>
                        )}
                      </DraggableItem>
                    ) : (
                      <div key={getItemId(item)} className="bg-background rounded-lg shadow-sm">
                        {renderCard(item)}
                      </div>
                    )
                  )
                ) : (
                  <div className="flex items-center justify-center h-20 text-sm text-muted-foreground/60 italic">
                    No items
                  </div>
                )}
              </DroppableColumn>
            </div>
          );
        })}
      </div>

      {/* Desktop view - horizontal scrollable */}
      <ScrollArea className="hidden md:block w-full whitespace-nowrap">
        <div className="flex gap-4 pb-4 min-h-[500px]">
          {columns.map((column) => {
            const columnItems = itemsByStatus[column.status] || [];

            return (
              <div key={column.status} className="flex-shrink-0 w-[340px]">
                <div className="flex flex-col h-full">
                  <div
                    className={cn(
                      "rounded-t-lg px-4 py-3 border-x border-t",
                      column.bgColor,
                      "border-b-0"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className={cn("flex items-center gap-2 text-sm font-semibold", column.color)}>
                        {column.icon}
                        <span>{column.title}</span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-xs font-medium px-2 py-0.5",
                          columnItems.length > 0 && "bg-background"
                        )}
                      >
                        {columnItems.length}
                      </Badge>
                    </div>
                  </div>
                  <DroppableColumn
                    id={column.status}
                    className="flex-1 bg-muted/20 rounded-b-lg border-x border-b p-3 space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto"
                  >
                    {columnItems.length > 0 ? (
                      columnItems.map((item) =>
                        enableDragDrop ? (
                          <DraggableItem key={getItemId(item)} id={getItemId(item)}>
                            {(isDragging) => (
                              <div className="bg-background rounded-lg shadow-sm">
                                {renderCard(item, isDragging)}
                              </div>
                            )}
                          </DraggableItem>
                        ) : (
                          <div key={getItemId(item)} className="bg-background rounded-lg shadow-sm">
                            {renderCard(item)}
                          </div>
                        )
                      )
                    ) : (
                      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground/60 italic">
                        No items
                      </div>
                    )}
                  </DroppableColumn>
                </div>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" className="mt-2" />
      </ScrollArea>
    </div>
  );

  if (!enableDragDrop) {
    return content;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {content}
      <DragOverlay>
        {activeItem ? (
          <div className="bg-background rounded-lg shadow-lg">
            {renderCard(activeItem, true)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
