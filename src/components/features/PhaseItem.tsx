"use client";

import { useRouter } from "next/navigation";
import { GripVertical, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { StatusPopover } from "@/components/ui/status-popover";
import { ActionMenu } from "@/components/ui/action-menu";
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

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: phase.id });

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
    } catch (error) {
      console.error("Failed to delete phase:", error);
    }
  };

  return (
    <div ref={setNodeRef} style={style} className={`${isDragging ? "opacity-50 z-50" : ""}`}>
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
          <div className="flex-1 min-w-0 cursor-pointer hover:text-primary" onClick={handleNavigateToPhase}>
            <span className="text-sm font-medium truncate">{phase.name}</span>
          </div>

          {/* Status Badge */}
          <StatusPopover statusType="phase" currentStatus={phase.status} onUpdate={handleStatusUpdate} />

          {/* Actions Menu */}
          <ActionMenu
            actions={[
              {
                label: "Delete",
                icon: Trash2,
                variant: "destructive",
                confirmation: {
                  title: "Delete Phase",
                  description: `Are you sure you want to delete "${phase.name}"? Any tickets in this phase will be moved to "Unassigned".`,
                  onConfirm: handleDelete,
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
