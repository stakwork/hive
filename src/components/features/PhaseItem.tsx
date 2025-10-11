"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPopover } from "@/components/ui/status-popover";
import { TicketList } from "./TicketList";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { PhaseListItem, TicketListItem } from "@/types/roadmap";
import type { PhaseStatus } from "@prisma/client";

interface PhaseItemProps {
  phase: PhaseListItem;
  featureId: string;
  workspaceSlug: string;
  onUpdate: (phaseId: string, updates: { name?: string; description?: string; status?: PhaseStatus }) => Promise<void>;
  onDelete: (phaseId: string) => Promise<void>;
}

export function PhaseItem({ phase, featureId, workspaceSlug, onUpdate, onDelete }: PhaseItemProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: phase.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleToggleExpand = async () => {
    if (!isExpanded && tickets.length === 0 && !loadingTickets) {
      // Load tickets when expanding for the first time
      try {
        setLoadingTickets(true);
        const response = await fetch(`/api/phases/${phase.id}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            setTickets(result.data.tickets || []);
          }
        }
      } catch (error) {
        console.error("Failed to load tickets:", error);
      } finally {
        setLoadingTickets(false);
      }
    }
    setIsExpanded(!isExpanded);
  };

  const handleTicketAdded = (newTicket: TicketListItem) => {
    setTickets([...tickets, newTicket]);
  };

  const handleTicketsReordered = (reorderedTickets: TicketListItem[]) => {
    setTickets(reorderedTickets);
  };

  const handleNavigateToPhase = () => {
    router.push(`/w/${workspaceSlug}/phases/${phase.id}`);
  };

  const handleStatusUpdate = async (status: PhaseStatus) => {
    try {
      await onUpdate(phase.id, { status });
    } catch (error) {
      console.error("Failed to update phase status:", error);
      throw error;
    }
  };

  const handleDelete = async () => {
    try {
      await onDelete(phase.id);
    } catch (error) {
      console.error("Failed to delete phase:", error);
    }
  };

  const ticketCount = phase._count?.tickets || 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isDragging ? "opacity-50 z-50" : ""}`}
    >
      <div className="rounded-lg border bg-card transition-colors">
        <div className="flex items-center gap-2 p-3">
          {/* Drag Handle */}
          <Button
            {...attributes}
            {...listeners}
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8 hover:bg-transparent cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="h-4 w-4" />
            <span className="sr-only">Drag to reorder</span>
          </Button>

          {/* Expand/Collapse Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleExpand}
            className="size-8 shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="sr-only">
              {isExpanded ? "Collapse" : "Expand"}
            </span>
          </Button>

          {/* Phase Name - Clickable to navigate */}
          <div
            className="flex-1 min-w-0 cursor-pointer hover:text-primary"
            onClick={handleNavigateToPhase}
          >
            <span className="text-sm font-medium truncate">
              {phase.name}
            </span>
          </div>

          {/* Status Badge */}
          <StatusPopover
            statusType="phase"
            currentStatus={phase.status}
            onUpdate={handleStatusUpdate}
          />

          {/* Ticket Count Badge */}
          {ticketCount > 0 && (
            <Badge variant="outline" className="shrink-0">
              {ticketCount} {ticketCount === 1 ? "ticket" : "tickets"}
            </Badge>
          )}

          {/* Delete Button */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete phase</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Phase</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{phase.name}&quot;?
                  {ticketCount > 0 && (
                    <span className="block mt-2 text-amber-600 font-medium">
                      This phase has {ticketCount} ticket{ticketCount === 1 ? "" : "s"}. They will be moved to &quot;Unassigned&quot;.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Expandable Tickets Section */}
        {isExpanded && (
          <div className="px-11 pb-3">
            <div className="border-t pt-3">
              <TicketList
                phaseId={phase.id}
                featureId={featureId}
                workspaceSlug={workspaceSlug}
                tickets={tickets}
                onTicketAdded={handleTicketAdded}
                onTicketsReordered={handleTicketsReordered}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
