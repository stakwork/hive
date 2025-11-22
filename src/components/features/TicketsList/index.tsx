"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Table as TableIcon, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AIButton } from "@/components/ui/ai-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GenerationPreview } from "@/components/features/GenerationPreview";
import { RoadmapTasksTable } from "@/components/features/RoadmapTasksTable";
import { DependencyGraph } from "@/components/features/DependencyGraph";
import { RoadmapTaskNode } from "@/components/features/DependencyGraph/nodes";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useRoadmapTaskMutations } from "@/hooks/useRoadmapTaskMutations";
import type { FeatureDetail, TicketListItem } from "@/types/roadmap";
import { TaskStatus, Priority } from "@prisma/client";
import { generateSphinxBountyUrl } from "@/lib/sphinx-tribes";

interface TicketsListProps {
  featureId: string;
  feature: FeatureDetail;
  onUpdate: (feature: FeatureDetail) => void;
}

interface GeneratedTask {
  title: string;
  description?: string;
  priority: string;
  tempId: string;
  dependsOn?: string[];
}

interface GeneratedPhase {
  name: string;
  description?: string;
  tasks: GeneratedTask[];
}

interface GeneratedContent {
  phases: GeneratedPhase[];
}

export function TicketsList({ featureId, feature, onUpdate }: TicketsListProps) {
  const router = useRouter();
  const { slug: workspaceSlug } = useWorkspace();

  // Task creation state
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketDescription, setNewTicketDescription] = useState("");
  const [newTicketStatus, setNewTicketStatus] = useState<TaskStatus>("TODO");
  const [newTicketPriority, setNewTicketPriority] = useState<Priority>("MEDIUM");
  const [newTicketAssigneeId, setNewTicketAssigneeId] = useState<string | null>(null);
  const [newTicketAssigneeData, setNewTicketAssigneeData] = useState<{
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null>(null);

  // View toggle
  const [activeView, setActiveView] = useState<"table" | "graph">("table");

  // AI generation state
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);

  // Refs
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { createTicket, loading: creatingTicket } = useRoadmapTaskMutations();

  // Get the default phase (Phase 1)
  const defaultPhase = feature.phases?.[0];

  // Get all tickets from the default phase
  const tickets = defaultPhase?.tasks || [];

  // Auto-focus after ticket creation completes
  useEffect(() => {
    if (!creatingTicket && !newTicketTitle && isCreatingTicket) {
      titleInputRef.current?.focus();
    }
  }, [creatingTicket, newTicketTitle, isCreatingTicket]);

  const handleCreateTicket = async () => {
    if (!newTicketTitle.trim() || !defaultPhase) return;

    const ticket = await createTicket({
      featureId,
      phaseId: defaultPhase.id,
      title: newTicketTitle,
      description: newTicketDescription || undefined,
      status: newTicketStatus,
      priority: newTicketPriority,
      assigneeId: newTicketAssigneeId,
    });

    if (ticket && feature.phases) {
      // Add new ticket to the list
      const updatedPhases = feature.phases.map((phase) => {
        if (phase.id === defaultPhase.id) {
          return {
            ...phase,
            tasks: [...phase.tasks, ticket],
          };
        }
        return phase;
      });

      onUpdate({
        ...feature,
        phases: updatedPhases,
      });

      if (newTicketAssigneeId === "system:bounty-hunter") {
        const bountyUrl = generateSphinxBountyUrl({
          id: ticket.id,
          title: ticket.title,
          description: ticket.description ?? undefined,
        });
        window.open(bountyUrl, "_blank", "noopener,noreferrer");
      }

      // Reset form (focus handled by useEffect)
      setNewTicketTitle("");
      setNewTicketDescription("");
      setNewTicketStatus("TODO");
      setNewTicketPriority("MEDIUM");
      setNewTicketAssigneeId(null);
      setNewTicketAssigneeData(null);
    }
  };

  const handleCancelCreateTicket = () => {
    setNewTicketTitle("");
    setNewTicketDescription("");
    setNewTicketStatus("TODO");
    setNewTicketPriority("MEDIUM");
    setNewTicketAssigneeId(null);
    setNewTicketAssigneeData(null);
    setIsCreatingTicket(false);
  };

  const handleTasksReordered = (reorderedTasks: TicketListItem[]) => {
    if (!feature.phases || !defaultPhase) return;

    const updatedPhases = feature.phases.map((phase) => {
      if (phase.id === defaultPhase.id) {
        return {
          ...phase,
          tasks: reorderedTasks,
        };
      }
      return phase;
    });

    onUpdate({
      ...feature,
      phases: updatedPhases,
    });
  };

  const handleTaskUpdate = (taskId: string, updates: Partial<TicketListItem>) => {
    if (!feature.phases || !defaultPhase) return;

    const updatedPhases = feature.phases.map((phase) => {
      if (phase.id === defaultPhase.id) {
        return {
          ...phase,
          tasks: phase.tasks.map((task) =>
            task.id === taskId ? { ...task, ...updates } : task
          ),
        };
      }
      return phase;
    });

    onUpdate({
      ...feature,
      phases: updatedPhases,
    });
  };

  const handleAcceptGenerated = async () => {
    if (!generatedContent || !defaultPhase) return;

    try {
      // Get all tasks from the first phase (we only generate one phase)
      const generatedTasks = generatedContent.phases[0]?.tasks || [];

      // Map tempId to real database ID
      const tempIdToRealId: Record<string, string> = {};

      // Create all tasks in order, mapping dependencies
      for (const task of generatedTasks) {
        // Map tempId dependencies to real IDs
        const dependsOnTaskIds = (task.dependsOn || [])
          .map((tempId) => tempIdToRealId[tempId])
          .filter(Boolean);

        const response = await fetch(`/api/features/${featureId}/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: task.title,
            description: task.description || null,
            status: TaskStatus.TODO,
            priority: task.priority as Priority,
            phaseId: defaultPhase.id,
            dependsOnTaskIds,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data?.id) {
            // Store the mapping from tempId to real database ID
            tempIdToRealId[task.tempId] = result.data.id;
          }
        }
      }

      // Refetch feature to get updated tickets
      const featureResponse = await fetch(`/api/features/${featureId}`);
      const featureResult = await featureResponse.json();
      if (featureResult.success) {
        onUpdate(featureResult.data);
      }

      setGeneratedContent(null);
    } catch (error) {
      console.error("Failed to accept generated tickets:", error);
    }
  };

  if (!defaultPhase) {
    return (
      <Empty>
        <EmptyHeader>No phase found</EmptyHeader>
        <EmptyDescription>
          This feature doesn't have a phase yet. Please contact support.
        </EmptyDescription>
      </Empty>
    );
  }

  // Show generation preview if we have generated content
  if (generatedContent) {
    const generatedTasks = generatedContent.phases[0]?.tasks || [];
    const previewContent = generatedTasks
      .map((task, idx) => {
        let content = `**${idx + 1}. ${task.title}**`;
        if (task.description) {
          content += `\n${task.description}`;
        }
        content += `\n*Priority: ${task.priority}*`;
        return content;
      })
      .join("\n\n");

    return (
      <GenerationPreview
        content={previewContent}
        source="quick"
        onAccept={handleAcceptGenerated}
        onReject={() => setGeneratedContent(null)}
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with Tasks heading, AI button, and Add Task button */}
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Tasks</Label>
        <div className="flex items-center gap-2">
          <AIButton<GeneratedContent>
            endpoint={`/api/features/${featureId}/generate`}
            params={{ type: "tickets" }}
            onGenerated={(results) => {
              if (results.length > 0) {
                setGeneratedContent(results[0]);
              }
            }}
            onGeneratingChange={setGenerating}
            label="Generate"
          />
          {!isCreatingTicket && (
            <Button onClick={() => setIsCreatingTicket(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>
          )}
        </div>
      </div>

      {/* Inline Task Creation Form */}
      {isCreatingTicket && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="space-y-3">
            <div>
              <Input
                ref={titleInputRef}
                placeholder="Task title..."
                value={newTicketTitle}
                onChange={(e) => setNewTicketTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !creatingTicket) {
                    handleCreateTicket();
                  } else if (e.key === "Escape") {
                    handleCancelCreateTicket();
                  }
                }}
                autoFocus
                disabled={creatingTicket}
              />
            </div>
            <AutoSaveTextarea
              id="new-ticket-description"
              label="Description"
              placeholder="Describe this task (optional)"
              value={newTicketDescription}
              onChange={(value) => setNewTicketDescription(value)}
              onBlur={() => {}} // No-op for inline form
              savedField={null}
              saving={false}
              saved={false}
              rows={3}
            />
            <div className="flex items-center gap-4">
              <StatusPopover
                statusType="task"
                currentStatus={newTicketStatus}
                onUpdate={async (status) => setNewTicketStatus(status)}
              />
              <PriorityPopover
                currentPriority={newTicketPriority}
                onUpdate={async (priority) => setNewTicketPriority(priority)}
              />
              <AssigneeCombobox
                workspaceSlug={workspaceSlug || ""}
                currentAssignee={newTicketAssigneeData}
                onSelect={async (assigneeId, assigneeData) => {
                  setNewTicketAssigneeId(assigneeId);
                  setNewTicketAssigneeData(assigneeData || null);
                }}
                showSpecialAssignees={true}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleCancelCreateTicket} disabled={creatingTicket}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleCreateTicket}
                disabled={creatingTicket || !newTicketTitle.trim()}
              >
                {creatingTicket ? (
                  <>
                    <Spinner className="h-4 w-4 mr-2" />
                    Creating...
                  </>
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View Toggle - Only show when there are tasks */}
      {tickets.length > 0 && (
        <div className="flex justify-start">
          <Tabs value={activeView} onValueChange={(value) => setActiveView(value as "table" | "graph")}>
            <TabsList>
              <TabsTrigger value="table" className="gap-2">
                <TableIcon className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="graph" className="gap-2">
                <Network className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Task View */}
      {activeView === "table" ? (
        <RoadmapTasksTable
          phaseId={defaultPhase.id}
          workspaceSlug={workspaceSlug || ""}
          tasks={tickets}
          onTasksReordered={handleTasksReordered}
          onTaskUpdate={handleTaskUpdate}
        />
      ) : (
        <DependencyGraph
          entities={tickets}
          getDependencies={(ticket) => ticket.dependsOnTaskIds || []}
          renderNode={(ticket) => <RoadmapTaskNode data={ticket} />}
          onNodeClick={(ticketId) => {
            router.push(`/w/${workspaceSlug}/tickets/${ticketId}`);
          }}
          emptyStateMessage="No tasks to display."
          noDependenciesMessage={{
            title: "No Dependencies Yet",
            description: "Add dependencies between tasks to see them visualized here.",
          }}
        />
      )}
    </div>
  );
}
