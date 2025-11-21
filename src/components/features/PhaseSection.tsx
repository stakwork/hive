"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Loader2, FolderPlus, Sparkles, Check, X, ChevronDown, ChevronRight } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { PhaseItem } from "@/components/features/PhaseItem";
import { AIButton } from "@/components/ui/ai-button";
import type { PhaseListItem, GeneratedPhasesAndTickets } from "@/types/roadmap";
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
  const shouldFocusRef = useRef(false);

  // AI generation state
  const [aiSuggestion, setAiSuggestion] = useState<GeneratedPhasesAndTickets | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const phaseIds = useMemo(() => phases.map((phase) => phase.id), [phases]);

  // Auto-focus after phase creation completes (not on mount)
  useEffect(() => {
    if (shouldFocusRef.current && !creatingPhase && !newPhaseName) {
      phaseInputRef.current?.focus();
      shouldFocusRef.current = false;
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
        shouldFocusRef.current = true;
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
    updates: { name?: string; description?: string; status?: PhaseStatus },
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
        const updatedPhases = phases.map((p) => (p.id === phaseId ? result.data : p));
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
      const reorderedPhases = arrayMove(phases, oldIndex, newIndex).map((phase, index) => ({
        ...phase,
        order: index,
      }));

      // Optimistic update
      onUpdate(reorderedPhases);

      // Call API to save new order
      try {
        const reorderData = reorderedPhases.map((phase, index) => ({
          id: phase.id,
          order: index,
        }));

        const response = await fetch(`/api/features/${featureId}/phases/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phases: reorderData }),
        });

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

  const handleAiGenerated = (results: GeneratedPhasesAndTickets[]) => {
    if (results.length > 0) {
      setAiSuggestion(results[0]);
      // Expand all phases by default
      setExpandedPhases(new Set(results[0].phases.map((_, i) => i)));
    }
  };

  const handleAcceptAi = async () => {
    if (!aiSuggestion) return;

    try {
      setAccepting(true);
      const response = await fetch(`/api/features/${featureId}/phases/batch-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phases: aiSuggestion.phases }),
      });

      if (!response.ok) {
        throw new Error("Failed to create phases and tickets");
      }

      const result = await response.json();
      if (result.success) {
        // Extract the phases from the result and update the parent
        const newPhases = result.data.map((item: any) => item.phase);
        onUpdate([...phases, ...newPhases]);
        setAiSuggestion(null);
      }
    } catch (error) {
      console.error("Failed to accept AI suggestion:", error);
    } finally {
      setAccepting(false);
    }
  };

  const handleRejectAi = () => {
    setAiSuggestion(null);
    setExpandedPhases(new Set());
  };

  const togglePhaseExpansion = (index: number) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Phases</Label>
          <AIButton<GeneratedPhasesAndTickets>
            endpoint={`/api/features/${featureId}/generate`}
            params={{ type: "phasesTickets" }}
            onGenerated={handleAiGenerated}
            tooltip="Generate with AI"
            iconOnly
          />
        </div>
        <p className="text-sm text-muted-foreground mt-1">Organize work into phases with specific tickets.</p>
      </div>

      {/* AI Suggestion Preview */}
      {aiSuggestion && (
        <div className="rounded-md border border-border bg-muted/50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-3">
              <p className="text-sm font-medium">Phase breakdown</p>

              {aiSuggestion.phases.map((phase, phaseIndex) => {
                const isExpanded = expandedPhases.has(phaseIndex);
                return (
                  <div key={phaseIndex} className="border border-border/50 rounded-lg bg-background/50 overflow-hidden">
                    <button
                      onClick={() => togglePhaseExpansion(phaseIndex)}
                      className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/50 transition-colors text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium">{phase.name}</p>
                        {phase.description && <p className="text-xs text-muted-foreground">{phase.description}</p>}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {phase.tasks.length} ticket{phase.tasks.length !== 1 ? "s" : ""}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2">
                        {phase.tasks.map((ticket, ticketIndex) => (
                          <div key={ticketIndex} className="pl-6 py-2 border-l-2 border-border/30">
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-muted-foreground mt-0.5">{ticket.tempId}</span>
                              <div className="flex-1">
                                <p className="text-sm font-medium">{ticket.title}</p>
                                {ticket.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{ticket.description}</p>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <span
                                    className={`text-xs px-1.5 py-0.5 rounded ${
                                      ticket.priority === "CRITICAL"
                                        ? "bg-red-100 text-red-700"
                                        : ticket.priority === "HIGH"
                                          ? "bg-orange-100 text-orange-700"
                                          : ticket.priority === "MEDIUM"
                                            ? "bg-blue-100 text-blue-700"
                                            : "bg-gray-100 text-gray-700"
                                    }`}
                                  >
                                    {ticket.priority}
                                  </span>
                                  {ticket.dependsOn && ticket.dependsOn.length > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      Depends on: {ticket.dependsOn.join(", ")}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={handleAcceptAi} disabled={accepting}>
              {accepting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2 text-green-600" />
              )}
              Accept All
            </Button>
            <Button size="sm" variant="ghost" onClick={handleRejectAi} disabled={accepting}>
              <X className="h-4 w-4 mr-2 text-red-600" />
              Reject
            </Button>
          </div>
        </div>
      )}

      {/* Only show Add Phase section when no AI suggestion is active */}
      {!aiSuggestion && (
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
            <Button size="sm" onClick={handleAddPhase} disabled={creatingPhase || !newPhaseName.trim()}>
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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
      )}
    </div>
  );
}
