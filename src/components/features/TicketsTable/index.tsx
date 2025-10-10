"use client";

import { useState, useMemo, useId, useRef, useEffect } from "react";
import {
  GripVertical,
  Trash2,
  MoreHorizontal,
  User,
  Loader2,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TicketListItem, PhaseListItem, UpdateTicketRequest } from "@/types/roadmap";
import { TICKET_STATUS_LABELS, TICKET_STATUS_COLORS } from "@/types/roadmap";
import type { TicketStatus, Priority } from "@prisma/client";

function DragHandle({ id }: { id: string }) {
  const { attributes, listeners } = useSortable({ id });

  return (
    <Button
      {...attributes}
      {...listeners}
      variant="ghost"
      size="icon"
      className="text-muted-foreground size-7 hover:bg-transparent cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="text-muted-foreground size-4" />
      <span className="sr-only">Drag to reorder</span>
    </Button>
  );
}

interface DraggableRowProps {
  ticket: TicketListItem;
  workspaceSlug: string;
  onUpdate: (ticketId: string, updates: UpdateTicketRequest) => Promise<void>;
  onDelete: (ticketId: string) => void;
}

function DraggableRow({
  ticket,
  workspaceSlug,
  onUpdate,
  onDelete,
}: DraggableRowProps) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: ticket.id,
  });

  const [title, setTitle] = useState(ticket.title);

  const handleTitleBlur = () => {
    if (title !== ticket.title) {
      onUpdate(ticket.id, { title });
    }
  };

  const handleStatusChange = (status: TicketStatus) => {
    onUpdate(ticket.id, { status });
  };

  return (
    <TableRow
      data-dragging={isDragging}
      ref={setNodeRef}
      className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      <TableCell className="w-8">
        <DragHandle id={ticket.id} />
      </TableCell>
      <TableCell className="min-w-[250px]">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          className="h-8 border-transparent bg-transparent shadow-none hover:bg-input/30 focus-visible:bg-background focus-visible:border"
        />
      </TableCell>
      <TableCell className="w-32">
        <Select value={ticket.status} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-8 border-transparent bg-transparent shadow-none hover:bg-input/30 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 justify-start">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                <Badge className={TICKET_STATUS_COLORS[value as TicketStatus]}>
                  {label}
                </Badge>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="w-40">
        <AssigneeCombobox
          workspaceSlug={workspaceSlug}
          currentAssignee={ticket.assignee}
          onSelect={async (assigneeId) => {
            await onUpdate(ticket.id, { assigneeId });
          }}
        />
      </TableCell>
      <TableCell className="w-12">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
              size="icon"
            >
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(ticket.id)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

interface TicketsTableProps {
  tickets: TicketListItem[];
  workspaceSlug: string;
  onReorder: (tickets: TicketListItem[]) => Promise<void>;
  onUpdate: (ticketId: string, updates: UpdateTicketRequest) => Promise<void>;
  onDelete: (ticketId: string) => Promise<void>;
  onCreate: (data: { title: string; status: TicketStatus; assigneeId?: string | null }) => Promise<void>;
}

export function TicketsTable({
  tickets: initialTickets,
  workspaceSlug,
  onReorder,
  onUpdate,
  onDelete,
  onCreate,
}: TicketsTableProps) {
  const [tickets, setTickets] = useState(initialTickets);
  const [deleteTicketId, setDeleteTicketId] = useState<string | null>(null);
  const [deletingTicket, setDeletingTicket] = useState(false);

  // New ticket form state
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketStatus, setNewTicketStatus] = useState<TicketStatus>("TODO");
  const [newTicketAssignee, setNewTicketAssignee] = useState<{ id: string; name: string | null; email: string | null; image: string | null } | null>(null);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const sortableId = useId();

  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
  );

  const ticketIds = useMemo<UniqueIdentifier[]>(
    () => tickets.map(({ id }) => id),
    [tickets]
  );

  // Sync local state with props
  useEffect(() => {
    setTickets(initialTickets);
  }, [initialTickets]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setTickets((tickets) => {
        const oldIndex = ticketIds.indexOf(active.id);
        const newIndex = ticketIds.indexOf(over.id);
        const reordered = arrayMove(tickets, oldIndex, newIndex);
        onReorder(reordered);
        return reordered;
      });
    }
  };

  const handleCreateTicket = async () => {
    if (!newTicketTitle.trim()) return;

    try {
      setCreatingTicket(true);
      await onCreate({
        title: newTicketTitle.trim(),
        status: newTicketStatus,
        assigneeId: newTicketAssignee?.id ?? null,
      });

      // Reset form
      setNewTicketTitle("");
      setNewTicketStatus("TODO");
      setNewTicketAssignee(null);

      // Focus back on input
      setTimeout(() => titleInputRef.current?.focus(), 0);
    } catch (error) {
      console.error("Failed to create ticket:", error);
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTicketId || deletingTicket) return;

    try {
      setDeletingTicket(true);
      await onDelete(deleteTicketId);
      setDeleteTicketId(null);
    } catch (error) {
      console.error("Error deleting ticket:", error);
    } finally {
      setDeletingTicket(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border">
        <DndContext
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          sensors={sensors}
          id={sortableId}
        >
          <Table>
            <TableHeader className="bg-muted sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* New Ticket Row - Always visible */}
              <TableRow className="bg-muted/30">
                <TableCell></TableCell>
                <TableCell>
                  <Input
                    ref={titleInputRef}
                    placeholder="Add a ticket..."
                    value={newTicketTitle}
                    onChange={(e) => setNewTicketTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !creatingTicket) {
                        handleCreateTicket();
                      }
                    }}
                    disabled={creatingTicket}
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={newTicketStatus}
                    onValueChange={(value) => setNewTicketStatus(value as TicketStatus)}
                    disabled={creatingTicket}
                  >
                    <SelectTrigger className="h-8 border-transparent bg-transparent shadow-none hover:bg-input/30 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 justify-start">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          <Badge className={TICKET_STATUS_COLORS[value as TicketStatus]}>
                            {label}
                          </Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <AssigneeCombobox
                    workspaceSlug={workspaceSlug}
                    currentAssignee={newTicketAssignee}
                    onSelect={async (assigneeId, assigneeData) => {
                      setNewTicketAssignee(assigneeData ?? null);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    onClick={handleCreateTicket}
                    disabled={creatingTicket || !newTicketTitle.trim()}
                    className="h-8"
                  >
                    {creatingTicket ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Add"
                    )}
                  </Button>
                </TableCell>
              </TableRow>

              {/* Existing Tickets */}
              {tickets.length > 0 ? (
                <SortableContext
                  items={ticketIds}
                  strategy={verticalListSortingStrategy}
                >
                  {tickets.map((ticket) => (
                    <DraggableRow
                      key={ticket.id}
                      ticket={ticket}
                      workspaceSlug={workspaceSlug}
                      onUpdate={onUpdate}
                      onDelete={setDeleteTicketId}
                    />
                  ))}
                </SortableContext>
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <div className="text-muted-foreground text-sm">
                      No tickets yet. Add one above to get started.
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DndContext>
      </div>

      {/* Delete Confirmation Modal */}
      <AlertDialog open={!!deleteTicketId} onOpenChange={() => setDeleteTicketId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this ticket? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingTicket}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deletingTicket}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingTicket ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
