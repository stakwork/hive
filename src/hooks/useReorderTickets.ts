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
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { TicketListItem } from "@/types/roadmap";

interface UseReorderTicketsParams {
  tickets: TicketListItem[];
  phaseId: string;
  onOptimisticUpdate?: (reorderedTickets: TicketListItem[]) => void;
}

export function useReorderTickets({
  tickets,
  phaseId,
  onOptimisticUpdate,
}: UseReorderTicketsParams) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = tickets.findIndex((t) => t.id === active.id);
    const newIndex = tickets.findIndex((t) => t.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedTickets = arrayMove(tickets, oldIndex, newIndex).map(
        (ticket, index) => ({
          ...ticket,
          order: index,
        })
      );

      // Optimistically update parent
      if (onOptimisticUpdate) {
        onOptimisticUpdate(reorderedTickets);
      }

      // Call API to save new order
      try {
        const reorderData = reorderedTickets.map((ticket, index) => ({
          id: ticket.id,
          order: index,
          phaseId: phaseId,
        }));

        const response = await fetch(`/api/tickets/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: reorderData }),
        });

        if (!response.ok) {
          throw new Error("Failed to reorder tickets");
        }
      } catch (error) {
        console.error("Failed to reorder tickets:", error);
        // TODO: Could add error rollback callback here
      }
    }
  };

  return {
    sensors,
    ticketIds,
    handleDragEnd,
    collisionDetection: closestCenter,
  };
}
