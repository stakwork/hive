"use client";

import { useState } from "react";
import { GripVertical, Trash2, User } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
} from "@/components/ui/item";
import type { TicketListItem } from "@/types/roadmap";
import { TICKET_STATUS_LABELS, TICKET_STATUS_COLORS } from "@/types/roadmap";
import type { TicketStatus, Priority } from "@prisma/client";

interface TicketCardProps {
  ticket: TicketListItem;
  onUpdate: (ticketId: string, updates: { title?: string; description?: string | null }) => Promise<void>;
  onDelete: (ticketId: string) => Promise<void>;
}

export function TicketCard({ ticket, onUpdate, onDelete }: TicketCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description || "");

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

  const handleTitleBlur = () => {
    if (title !== ticket.title) {
      onUpdate(ticket.id, { title });
    }
  };

  const handleDescriptionBlur = () => {
    if (description !== (ticket.description || "")) {
      onUpdate(ticket.id, { description: description || null });
    }
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this ticket?")) {
      await onDelete(ticket.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50 z-50" : ""}
    >
      <Item variant="outline" size="sm" className="group">
        <Button
          {...attributes}
          {...listeners}
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 hover:bg-transparent cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
          <span className="sr-only">Drag to reorder</span>
        </Button>

        <ItemContent className="flex-1 min-w-0">
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 min-w-0">
              {!isExpanded ? (
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => setIsExpanded(true)}
                >
                  <ItemTitle className="line-clamp-1">{ticket.title}</ItemTitle>
                  <Badge className={TICKET_STATUS_COLORS[ticket.status]} variant="outline">
                    {TICKET_STATUS_LABELS[ticket.status]}
                  </Badge>
                  {ticket.assignee && (
                    <Avatar className="size-5">
                      <AvatarImage src={ticket.assignee.image || undefined} />
                      <AvatarFallback className="text-xs">
                        <User className="w-3 h-3" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ) : (
                <div className="space-y-2 w-full" onClick={(e) => e.stopPropagation()}>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleTitleBlur}
                    placeholder="Ticket title..."
                    className="text-sm"
                  />
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    placeholder="Add description..."
                    rows={3}
                    className="resize-none text-sm"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className={TICKET_STATUS_COLORS[ticket.status]} variant="outline">
                        {TICKET_STATUS_LABELS[ticket.status]}
                      </Badge>
                      {ticket.assignee && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Avatar className="size-5">
                            <AvatarImage src={ticket.assignee.image || undefined} />
                            <AvatarFallback className="text-xs">
                              <User className="w-3 h-3" />
                            </AvatarFallback>
                          </Avatar>
                          <span>{ticket.assignee.name || ticket.assignee.email}</span>
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsExpanded(false)}
                    >
                      Collapse
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ItemContent>

        <ItemActions>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </ItemActions>
      </Item>
    </div>
  );
}
