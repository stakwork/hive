"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, MoreVertical, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PhaseListItem } from "@/types/roadmap";
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
      setShowDeleteDialog(false);
    } catch (error) {
      console.error("Failed to delete phase:", error);
    }
  };

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

          {/* Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground shrink-0"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Phase</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{phase.name}&quot;? Any tickets in this phase will be moved to &quot;Unassigned&quot;.
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
  );
}
