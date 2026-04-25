"use client";

import { useMemo } from "react";
import {
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { MilestoneResponse } from "@/types/initiatives";

interface UseReorderMilestonesParams {
  milestones: MilestoneResponse[];
  initiativeId: string;
  githubLogin: string;
  onOptimisticUpdate: (reordered: MilestoneResponse[]) => void;
}

export function useReorderMilestones({
  milestones,
  initiativeId,
  githubLogin,
  onOptimisticUpdate,
}: UseReorderMilestonesParams) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const milestoneIds = useMemo(() => milestones.map((m) => m.id), [milestones]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = milestones.findIndex((m) => m.id === active.id);
    const newIndex = milestones.findIndex((m) => m.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(milestones, oldIndex, newIndex).map((m, index) => ({
      ...m,
      sequence: index + 1,
    }));

    // Optimistically update
    onOptimisticUpdate(reordered);

    try {
      const res = await fetch(
        `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            milestones: reordered.map((m) => ({ id: m.id, sequence: m.sequence })),
          }),
        }
      );

      if (!res.ok) {
        throw new Error("Failed to reorder milestones");
      }
    } catch (error) {
      console.error("Failed to reorder milestones:", error);
      // Revert by restoring original order
      onOptimisticUpdate(milestones);
    }
  };

  return {
    sensors,
    milestoneIds,
    handleDragEnd,
    collisionDetection: closestCenter,
  };
}
