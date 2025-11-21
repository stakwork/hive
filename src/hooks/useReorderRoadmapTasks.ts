"use client";

import { useMemo } from "react";
import { closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { TicketListItem } from "@/types/roadmap";

interface UseReorderRoadmapTasksParams {
  tasks: TicketListItem[];
  phaseId: string;
  onOptimisticUpdate?: (reorderedTasks: TicketListItem[]) => void;
}

export function useReorderRoadmapTasks({ tasks, phaseId, onOptimisticUpdate }: UseReorderRoadmapTasksParams) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedTasks = arrayMove(tasks, oldIndex, newIndex).map((task, index) => ({
        ...task,
        order: index,
      }));

      // Optimistically update parent
      if (onOptimisticUpdate) {
        onOptimisticUpdate(reorderedTasks);
      }

      // Call API to save new order
      try {
        const reorderData = reorderedTasks.map((task, index) => ({
          id: task.id,
          order: index,
          phaseId: phaseId,
        }));

        const response = await fetch(`/api/tickets/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: reorderData }),
        });

        if (!response.ok) {
          throw new Error("Failed to reorder roadmap tasks");
        }
      } catch (error) {
        console.error("Failed to reorder roadmap tasks:", error);
        // TODO: Could add error rollback callback here
      }
    }
  };

  return {
    sensors,
    taskIds,
    handleDragEnd,
    collisionDetection: closestCenter,
  };
}
