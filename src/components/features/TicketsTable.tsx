"use client";

import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { useTicketMutations } from "@/hooks/useTicketMutations";
import { useReorderTickets } from "@/hooks/useReorderTickets";
import type { TicketListItem } from "@/types/roadmap";
import type { TicketStatus, Priority } from "@prisma/client";

interface TicketsTableProps {
  phaseId: string;
  workspaceSlug: string;
  tickets: TicketListItem[];
  onTicketsReordered?: (tickets: TicketListItem[]) => void;
  onTicketUpdate?: (ticketId: string, updates: Partial<TicketListItem>) => void;
}

function SortableTableRow({
  ticket,
  workspaceSlug,
  onClick,
  onStatusUpdate,
  onPriorityUpdate,
  onAssigneeUpdate,
}: {
  ticket: TicketListItem;
  workspaceSlug: string;
  onClick: () => void;
  onStatusUpdate: (status: TicketStatus) => Promise<void>;
  onPriorityUpdate: (priority: Priority) => Promise<void>;
  onAssigneeUpdate: (assigneeId: string | null) => Promise<void>;
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
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`cursor-pointer hover:bg-muted/50 group ${
        isDragging ? "opacity-50 z-50" : ""
      }`}
    >
      <TableCell className="w-[40px]">
        <div
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell className="font-medium" onClick={onClick}>
        {ticket.title}
      </TableCell>
      <TableCell>
        <StatusPopover
          statusType="ticket"
          currentStatus={ticket.status}
          onUpdate={onStatusUpdate}
        />
      </TableCell>
      <TableCell>
        <PriorityPopover
          currentPriority={ticket.priority}
          onUpdate={onPriorityUpdate}
        />
      </TableCell>
      <TableCell>
        <AssigneeCombobox
          workspaceSlug={workspaceSlug}
          currentAssignee={ticket.assignee}
          onSelect={onAssigneeUpdate}
        />
      </TableCell>
    </TableRow>
  );
}

export function TicketsTable({ phaseId, workspaceSlug, tickets, onTicketsReordered, onTicketUpdate }: TicketsTableProps) {
  const router = useRouter();

  const { updateTicket } = useTicketMutations();
  const { sensors, ticketIds, handleDragEnd, collisionDetection } = useReorderTickets({
    tickets,
    phaseId,
    onOptimisticUpdate: onTicketsReordered,
  });

  const handleRowClick = (ticketId: string) => {
    router.push(`/w/${workspaceSlug}/tickets/${ticketId}`);
  };

  const handleUpdateTicket = async (ticketId: string, updates: { status?: TicketStatus; priority?: Priority; assigneeId?: string | null }) => {
    const updatedTicket = await updateTicket({ ticketId, updates });
    if (updatedTicket && onTicketUpdate) {
      onTicketUpdate(ticketId, updatedTicket);
    }
  };

  if (tickets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No tickets in this phase yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragEnd={handleDragEnd}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="w-[50%]">Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Assignee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
              {tickets
                .sort((a, b) => a.order - b.order)
                .map((ticket) => (
                  <SortableTableRow
                    key={ticket.id}
                    ticket={ticket}
                    workspaceSlug={workspaceSlug}
                    onClick={() => handleRowClick(ticket.id)}
                    onStatusUpdate={async (status) => handleUpdateTicket(ticket.id, { status })}
                    onPriorityUpdate={async (priority) => handleUpdateTicket(ticket.id, { priority })}
                    onAssigneeUpdate={async (assigneeId) => handleUpdateTicket(ticket.id, { assigneeId })}
                  />
                ))}
            </SortableContext>
          </TableBody>
        </Table>
      </DndContext>
    </div>
  );
}
