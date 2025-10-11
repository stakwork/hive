"use client";

import { useRouter } from "next/navigation";
import { GripVertical, User as UserIcon, Plus } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { InlineCreateForm } from "@/components/shared/InlineCreateForm";
import { useTicketMutations } from "@/hooks/useTicketMutations";
import { useReorderTickets } from "@/hooks/useReorderTickets";
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

  const { createTicket } = useTicketMutations();
  const { sensors, ticketIds, handleDragEnd, collisionDetection } = useReorderTickets({
    tickets,
    phaseId,
    onOptimisticUpdate: onTicketsReordered,
  });

  const handleAddTicket = async (title: string) => {
    const ticket = await createTicket({
      featureId,
      phaseId,
      title,
    });

    if (ticket) {
      onTicketAdded(ticket);
    }
  };

  const handleTicketClick = (ticketId: string) => {
    router.push(`/w/${workspaceSlug}/tickets/${ticketId}`);
  };

  return (
    <div className="space-y-2">
      {/* Add ticket input */}
      <InlineCreateForm
        placeholder="Add a ticket..."
        buttonText=""
        buttonIcon={Plus}
        onSubmit={handleAddTicket}
        keepOpenAfterSubmit={true}
        className=""
      />

      {/* Tickets list with drag and drop */}
      {tickets.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
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
