"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Loader2, FolderPlus } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@/hooks/useSortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhaseItem } from "@/components/features/PhaseItem";
import type { PhaseListItem } from "@/types/roadmap";
import type { PhaseStatus } from "@prisma/client";

interface PhaseSectionProps {
  featureId: string;
  workspaceSlug: string;
  phases: PhaseListItem[];
  onUpdate: (phases: PhaseListItem[]) => void;
}

export function PhaseSection({ featureId, workspaceSlug, phases, onUpdate }: PhaseSectionProps) {
  const [newPhaseName, setNewPhaseName] = useState("");
  const [creatingPhase, setCreatingPhase] = useState(false);
  const phaseInputRef = useRef<HTMLInputElement>(null);

  const { sensors, collisionDetection } = useSortable();

  const phaseIds = useMemo(() => phases.map((phase) => phase.id), [phases]);

  // Auto-focus after phase creation completes
  useEffect(() => {
    if (!creatingPhase && !newPhaseName) {
      phaseInputRef.current?.focus();
    }
  }, [creatingPhase, newPhaseName]);

  const handleAddPhase = async () => {
    if (!newPhaseName.trim()) return;

    try {
      setCreatingPhase(true);
      const response = await fetch(`/api/features/${featureId}/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPhaseName.trim() }),
      });

      if (!response.ok) {
        throw new Error("Failed to create phase");
      }

      const result = await response.json();
      if (result.success) {
        onUpdate([...phases, result.data]);
        setNewPhaseName("");
      }
    } catch (error) {
      console.error("Failed to create phase:", error);
    } finally {
      setCreatingPhase(false);
    }
  };

  const handleUpdatePhase = async (
    phaseId: string,
    updates: { name?: string; description?: string; status?: PhaseStatus }
  ) => {
    try {
      const response = await fetch(`/api/phases/${phaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Failed to update phase");
      }

      const result = await response.json();
      if (result.success) {
        const updatedPhases = phases.map((p) =>
          p.id === phaseId ? result.data : p
        );
        onUpdate(updatedPhases);
      }
    } catch (error) {
      console.error("Failed to update phase:", error);
      throw error;
    }
  };

  const handleDeletePhase = async (phaseId: string) => {
    try {
      const response = await fetch(`/api/phases/${phaseId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete phase");
      }

      const updatedPhases = phases.filter((p) => p.id !== phaseId);
      onUpdate(updatedPhases);
    } catch (error) {
      console.error("Failed to delete phase:", error);
      throw error;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = phases.findIndex((p) => p.id === active.id);
    const newIndex = phases.findIndex((p) => p.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedPhases = arrayMove(phases, oldIndex, newIndex).map(
        (phase, index) => ({
          ...phase,
          order: index,
        })
      );

      // Optimistic update
      onUpdate(reorderedPhases);

      // Call API to save new order
      try {
        const reorderData = reorderedPhases.map((phase, index) => ({
          id: phase.id,
          order: index,
        }));

        const response = await fetch(
          `/api/features/${featureId}/phases/reorder`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phases: reorderData }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to reorder phases");
        }
      } catch (error) {
        console.error("Failed to reorder phases:", error);
        // On error, could refetch to restore correct order
        // For now, the optimistic update stays
      }
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Phases</Label>
        <p className="text-sm text-muted-foreground mt-1">
          Organize work into phases with specific tickets.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/30">
        {/* Add Phase Input */}
        <div className="flex gap-2 p-4">
          <Input
            ref={phaseInputRef}
            placeholder="Enter phase name..."
            value={newPhaseName}
            onChange={(e) => setNewPhaseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creatingPhase) {
                handleAddPhase();
              }
            }}
            disabled={creatingPhase}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={handleAddPhase}
            disabled={creatingPhase || !newPhaseName.trim()}
          >
            {creatingPhase ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <FolderPlus className="h-4 w-4 mr-2" />
                Add Phase
              </>
            )}
          </Button>
        </div>

        {/* Phases List */}
        {phases.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={phaseIds} strategy={verticalListSortingStrategy}>
              <div className="px-4 pb-4 flex flex-col gap-2 overflow-hidden">
                {phases
                  .sort((a, b) => a.order - b.order)
                  .map((phase) => (
                    <PhaseItem
                      key={phase.id}
                      phase={phase}
                      featureId={featureId}
                      workspaceSlug={workspaceSlug}
                      onUpdate={handleUpdatePhase}
                      onDelete={handleDeletePhase}
                    />
                  ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="px-4 pb-4">
            <div className="text-center py-8 text-muted-foreground text-sm">
              <FolderPlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No phases yet. Add a phase to get started.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
