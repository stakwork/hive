"use client";

import { useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusPopover } from "@/components/ui/status-popover";
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
import type { PhaseListItem } from "@/types/roadmap";
import type { PhaseStatus } from "@prisma/client";

interface PhaseItemProps {
  phase: PhaseListItem;
  onUpdate: (phaseId: string, updates: { name?: string; description?: string; status?: PhaseStatus }) => Promise<void>;
  onDelete: (phaseId: string) => Promise<void>;
}

export function PhaseItem({ phase, onUpdate, onDelete }: PhaseItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(phase.name);
  const [isUpdating, setIsUpdating] = useState(false);

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

  const handleNameSave = async () => {
    if (editedName.trim() && editedName !== phase.name) {
      try {
        setIsUpdating(true);
        await onUpdate(phase.id, { name: editedName.trim() });
      } catch (error) {
        console.error("Failed to update phase name:", error);
        setEditedName(phase.name);
      } finally {
        setIsUpdating(false);
      }
    } else {
      setEditedName(phase.name);
    }
    setIsEditing(false);
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
      <div className="rounded-lg border bg-card hover:bg-muted/30 transition-colors">
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

          {/* Phase Name - Editable */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <Input
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleNameSave();
                  } else if (e.key === "Escape") {
                    setEditedName(phase.name);
                    setIsEditing(false);
                  }
                }}
                disabled={isUpdating}
                className="h-7 text-sm font-medium"
                autoFocus
              />
            ) : (
              <div
                className="text-sm font-medium cursor-pointer hover:text-primary truncate"
                onClick={() => setIsEditing(true)}
              >
                {phase.name}
              </div>
            )}
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
      </div>
    </div>
  );
}
