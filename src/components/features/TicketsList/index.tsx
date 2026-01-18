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
import { DeepResearchProgress } from "@/components/features/DeepResearchProgress";
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
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";
import { useAIGeneration } from "@/hooks/useAIGeneration";
import { usePusherConnection, type TaskTitleUpdateEvent } from "@/hooks/usePusherConnection";
import { GenerationControls } from "@/components/features/GenerationControls";
import type { FeatureDetail, TicketListItem } from "@/types/roadmap";
import { TaskStatus, Priority, WorkflowStatus } from "@prisma/client";
import { generateSphinxBountyUrl } from "@/lib/sphinx-tribes";
import { toast } from "sonner";

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
  const { slug: workspaceSlug, id: workspaceId } = useWorkspace();

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
  const [acceptingTasks, setAcceptingTasks] = useState(false);

  // Refs
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { createTicket, loading: creatingTicket } = useRoadmapTaskMutations();

  // Deep research hooks
  const { latestRun, refetch: refetchStakworkRun } = useStakworkGeneration({
    featureId,
    type: "TASK_GENERATION",
    enabled: true,
  });

  const aiGeneration = useAIGeneration({
    featureId,
    workspaceId: workspaceId || "",
    type: "TASK_GENERATION",
    enabled: true,
  });

  const [initiatingDeepThink, setInitiatingDeepThink] = useState(false);

  // Get the default phase (Phase 1)
  const defaultPhase = feature.phases?.[0];

  // Get all tickets from the default phase
  const tickets = defaultPhase?.tasks || [];

  // Real-time task status updates via Pusher
  const handleTaskStatusUpdate = (update: TaskTitleUpdateEvent & { status?: TaskStatus; workflowStatus?: WorkflowStatus }) => {
    // Only update if this is a task in our current feature's phase
    const taskExists = tickets.some(task => task.id === update.taskId);
    if (!taskExists) return;

    console.log('Received task status update:', update);

    // Update the task with new status
    if (update.status !== undefined || update.workflowStatus !== undefined) {
      handleTaskUpdate(update.taskId, {
        ...(update.status !== undefined && { status: update.status }),
        ...(update.workflowStatus !== undefined && { workflowStatus: update.workflowStatus }),
      });
    }
  };

  // Subscribe to workspace channel for real-time task updates
  usePusherConnection({
    workspaceSlug: workspaceSlug || null,
    enabled: !!workspaceSlug,
    onTaskTitleUpdate: handleTaskStatusUpdate,
  });

  // Auto-focus after ticket creation completes
  useEffect(() => {
    if (!creatingTicket && !newTicketTitle && isCreatingTicket) {
      titleInputRef.current?.focus();
    }
  }, [creatingTicket, newTicketTitle, isCreatingTicket]);

  // Watch for deep research completion
  useEffect(() => {
    if (
      latestRun?.status === "COMPLETED" &&
      !latestRun.decision &&
      latestRun.result &&
      !aiGeneration.content // Don't re-set if already accepted/cleared
    ) {
      try {
        const parsed = JSON.parse(latestRun.result);
        aiGeneration.setContent(latestRun.result, "deep", latestRun.id);
        setGeneratedContent(parsed);
      } catch (error) {
        console.error("Failed to parse deep research result:", error);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun]); // aiGeneration.setContent is stable (useCallback), safe to omit

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

      if (newTicketAssigneeId === "system:task-coordinator") {
        toast.info("Task queued for coordinator", {
          description: "Processing begins when a machine is available",
        });
      } else if (newTicketAssigneeId === "system:bounty-hunter") {
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

  const handleDeepThink = async () => {
    try {
      setInitiatingDeepThink(true);
      await aiGeneration.regenerate(false);
      await refetchStakworkRun();
    } catch (error) {
      console.error("Deep think failed:", error);
    } finally {
      setInitiatingDeepThink(false);
    }
  };

  const handleRetry = async () => {
    try {
      setInitiatingDeepThink(true);
      await aiGeneration.regenerate(true);
      await refetchStakworkRun();
    } catch (error) {
      console.error("Retry failed:", error);
    } finally {
      setInitiatingDeepThink(false);
    }
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
    if (!generatedContent || !defaultPhase || acceptingTasks) return;

    setAcceptingTasks(true);
    try {
      // Get all tasks from the first phase (we only generate one phase)
      const generatedTasks = generatedContent.phases[0]?.tasks || [];

      // Clear preview immediately
      setGeneratedContent(null);

      if (aiGeneration.source === "quick") {
        // QUICK PATH: Frontend creates tasks directly via API
        const tempIdToRealId: Record<string, string> = {};

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
              tempIdToRealId[task.tempId] = result.data.id;
            }
          }
        }

        // Call accept to clear state (no API call for quick source)
        await aiGeneration.accept();
      } else if (aiGeneration.source === "deep") {
        // DEEP PATH: Backend creates tasks via decision handler
        await aiGeneration.accept();
      }

      // Refetch to get created tasks
      const featureResponse = await fetch(`/api/features/${featureId}`);
      const featureResult = await featureResponse.json();
      if (featureResult.success) {
        onUpdate(featureResult.data);
      }
    } catch (error) {
      console.error("Failed to accept generated tickets:", error);
      // Refetch on error
      const featureResponse = await fetch(`/api/features/${featureId}`);
      const featureResult = await featureResponse.json();
      if (featureResult.success) {
        onUpdate(featureResult.data);
      }
    } finally {
      setAcceptingTasks(false);
    }
  };

  const handleRejectGenerated = async () => {
    if (aiGeneration.source === "deep") {
      await aiGeneration.reject();
    }
    setGeneratedContent(null);
    aiGeneration.clear();
  };

  const handleProvideFeedback = async (feedback: string) => {
    await aiGeneration.provideFeedback(feedback);
    setGeneratedContent(null);
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

  // Show progress overlay while deep research is running
  if (latestRun?.status === "IN_PROGRESS" && latestRun.projectId) {
    return <DeepResearchProgress projectId={latestRun.projectId} />;
  }

  // Show generation preview if we have generated task content (JSON format)
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
        source={aiGeneration.source || "quick"}
        onAccept={handleAcceptGenerated}
        onReject={handleRejectGenerated}
        onProvideFeedback={aiGeneration.source === "deep" ? handleProvideFeedback : undefined}
        isLoading={aiGeneration.isLoading || acceptingTasks}
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with Tasks heading, AI button, and Add Task button */}
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Tasks</Label>
        <div className="flex items-center gap-2">
          {/* Quick Generate */}
          <AIButton<GeneratedContent>
            endpoint={`/api/features/${featureId}/generate`}
            params={{ type: "tickets" }}
            onGenerated={(results) => {
              if (results.length > 0) {
                aiGeneration.setContent(JSON.stringify(results[0]), "quick");
                setGeneratedContent(results[0]);
              }
            }}
            onGeneratingChange={setGenerating}
            label="Generate"
            disabled={initiatingDeepThink || latestRun?.status === "IN_PROGRESS"}
          />

          {/* Deep Research */}
          <GenerationControls
            onQuickGenerate={() => {}}
            onDeepThink={handleDeepThink}
            onRetry={handleRetry}
            status={latestRun?.status}
            isLoading={aiGeneration.isLoading || initiatingDeepThink}
            isQuickGenerating={generating}
            disabled={false}
            showDeepThink={true}
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
