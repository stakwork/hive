"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, GripVertical, User as UserIcon } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TicketListItem } from "@/types/roadmap";

interface TicketListProps {
  phaseId: string;
  featureId: string;
  workspaceSlug: string;
  tickets: TicketListItem[];
  onTicketAdded: (ticket: TicketListItem) => void;
  onTicketsReordered?: (tickets: TicketListItem[]) => void;
}

function SortableTicketItem({
  ticket,
  workspaceSlug,
  onClick,
}: {
  ticket: TicketListItem;
  workspaceSlug: string;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors group ${
        isDragging ? "opacity-50 z-50" : ""
      }`}
    >
      {/* Drag Handle - visible on hover */}
      <div
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Clickable ticket content */}
      <div
        onClick={onClick}
        className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
      >
        {/* Title */}
        <span className="text-sm flex-1 truncate group-hover:text-primary">
          {ticket.title}
        </span>

        {/* Status badge */}
        <StatusBadge statusType="ticket" status={ticket.status} className="shrink-0" />

        {/* Assignee avatar - always shown */}
        <Avatar className="h-5 w-5 shrink-0">
          {ticket.assignee ? (
            <>
              <AvatarImage src={ticket.assignee.image || undefined} />
              <AvatarFallback className="text-[10px]">
                {ticket.assignee.name?.[0]?.toUpperCase() || <UserIcon className="h-3 w-3" />}
              </AvatarFallback>
            </>
          ) : (
            <AvatarFallback className="text-xs">
              <UserIcon className="h-3 w-3" />
            </AvatarFallback>
          )}
        </Avatar>
      </div>
    </div>
  );
}

export function TicketList({
  phaseId,
  featureId,
  workspaceSlug,
  tickets,
  onTicketAdded,
  onTicketsReordered,
}: TicketListProps) {
  const router = useRouter();
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [creatingTicket, setCreatingTicket] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);

  const handleAddTicket = async () => {
    if (!newTicketTitle.trim()) return;

    try {
      setCreatingTicket(true);
      const response = await fetch(`/api/features/${featureId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTicketTitle.trim(),
          phaseId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create ticket");
      }

      const result = await response.json();
      if (result.success) {
        onTicketAdded(result.data);
        setNewTicketTitle("");
      }
    } catch (error) {
      console.error("Failed to create ticket:", error);
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleTicketClick = (ticketId: string) => {
    router.push(`/w/${workspaceSlug}/tickets/${ticketId}`);
  };

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
      if (onTicketsReordered) {
        onTicketsReordered(reorderedTickets);
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
          body: JSON.stringify({ tickets: reorderData }),
        });

        if (!response.ok) {
          throw new Error("Failed to reorder tickets");
        }
      } catch (error) {
        console.error("Failed to reorder tickets:", error);
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Add ticket input */}
      <div className="flex gap-2">
        <Input
          placeholder="Add a ticket..."
          value={newTicketTitle}
          onChange={(e) => setNewTicketTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creatingTicket) {
              handleAddTicket();
            }
          }}
          disabled={creatingTicket}
          className="flex-1 h-8 text-sm"
        />
        <Button
          size="sm"
          onClick={handleAddTicket}
          disabled={creatingTicket || !newTicketTitle.trim()}
          className="h-8"
        >
          {creatingTicket ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
        </Button>
      </div>

      {/* Tickets list with drag and drop */}
      {tickets.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {tickets
                .sort((a, b) => a.order - b.order)
                .map((ticket) => (
                  <SortableTicketItem
                    key={ticket.id}
                    ticket={ticket}
                    workspaceSlug={workspaceSlug}
                    onClick={() => handleTicketClick(ticket.id)}
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="text-center py-4 text-xs text-muted-foreground">
          No tickets yet
        </div>
      )}
    </div>
  );
}
