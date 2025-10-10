"use client";

import { useState, useRef } from "react";
import { GripVertical, Trash2, Loader2, Plus } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TicketCard } from "@/components/features/TicketCard";
import type { PhaseListItem, TicketListItem } from "@/types/roadmap";

interface PhaseSectionProps {
  phase: PhaseListItem & { tickets: TicketListItem[] };
  onUpdatePhase: (phaseId: string, updates: { name?: string; description?: string | null }) => Promise<void>;
  onDeletePhase: (phaseId: string) => Promise<void>;
  onCreateTicket: (phaseId: string, title: string) => Promise<void>;
  onUpdateTicket: (ticketId: string, updates: { title?: string; description?: string | null }) => Promise<void>;
  onDeleteTicket: (ticketId: string) => Promise<void>;
  onReorderTickets: (tickets: TicketListItem[]) => Promise<void>;
}

export function PhaseSection({
  phase,
  onUpdatePhase,
  onDeletePhase,
  onCreateTicket,
  onUpdateTicket,
  onDeleteTicket,
  onReorderTickets,
}: PhaseSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [phaseName, setPhaseName] = useState(phase.name);
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [creatingTicket, setCreatingTicket] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const ticketInputRef = useRef<HTMLInputElement>(null);

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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleNameBlur = async () => {
    setIsEditingName(false);
    if (phaseName !== phase.name && phaseName.trim()) {
      await onUpdatePhase(phase.id, { name: phaseName.trim() });
    } else {
      setPhaseName(phase.name);
    }
  };

  const handleDelete = async () => {
    const ticketCount = phase.tickets.length;
    const message = ticketCount > 0
      ? `Are you sure you want to delete this phase? ${ticketCount} ticket(s) will be moved to unassigned.`
      : "Are you sure you want to delete this phase?";

    if (confirm(message)) {
      await onDeletePhase(phase.id);
    }
  };

  const handleAddTicket = async () => {
    if (!newTicketTitle.trim()) return;

    try {
      setCreatingTicket(true);
      await onCreateTicket(phase.id, newTicketTitle.trim());
      setNewTicketTitle("");
      setTimeout(() => {
        ticketInputRef.current?.focus();
      }, 0);
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleTicketDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = phase.tickets.findIndex((t) => t.id === active.id);
    const newIndex = phase.tickets.findIndex((t) => t.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedTickets = arrayMove(phase.tickets, oldIndex, newIndex).map((ticket, index) => ({
        ...ticket,
        order: index,
      }));

      onReorderTickets(reorderedTickets);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50 z-50" : ""}
    >
      <div className="border rounded-lg overflow-hidden">
        {/* Phase Header */}
        <div className="bg-muted/30 p-3 flex items-center gap-2 group">
          <Button
            {...attributes}
            {...listeners}
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-6 hover:bg-transparent cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
            <span className="sr-only">Drag to reorder</span>
          </Button>

          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
            {isEditingName ? (
              <Input
                ref={nameInputRef}
                value={phaseName}
                onChange={(e) => setPhaseName(e.target.value)}
                onBlur={handleNameBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleNameBlur();
                  } else if (e.key === "Escape") {
                    setPhaseName(phase.name);
                    setIsEditingName(false);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-medium h-7"
                autoFocus
              />
            ) : (
              <div
                className="text-sm font-medium hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingName(true);
                  setTimeout(() => nameInputRef.current?.focus(), 0);
                }}
              >
                {phase.name}
              </div>
            )}
          </div>

          <Badge variant="secondary" className="text-xs">
            {phase.tickets.length}
          </Badge>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Tickets */}
        {isExpanded && (
          <div className="p-3 space-y-2">
            {/* Add Ticket Input */}
            <div className="flex gap-2">
              <Input
                ref={ticketInputRef}
                placeholder="Add a ticket..."
                value={newTicketTitle}
                onChange={(e) => setNewTicketTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !creatingTicket) {
                    handleAddTicket();
                  }
                }}
                disabled={creatingTicket}
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={handleAddTicket}
                disabled={creatingTicket || !newTicketTitle.trim()}
              >
                {creatingTicket ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Ticket List */}
            {phase.tickets.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleTicketDragEnd}
              >
                <SortableContext
                  items={phase.tickets.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {phase.tickets
                      .sort((a, b) => a.order - b.order)
                      .map((ticket) => (
                        <TicketCard
                          key={ticket.id}
                          ticket={ticket}
                          onUpdate={onUpdateTicket}
                          onDelete={onDeleteTicket}
                        />
                      ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
