"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Trash2, Table as TableIcon, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EditableTitle } from "@/components/ui/editable-title";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { ActionMenu } from "@/components/ui/action-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RoadmapTasksTable } from "@/components/features/RoadmapTasksTable";
import { DependencyGraph } from "@/components/features/DependencyGraph";
import { RoadmapTaskNode } from "@/components/features/DependencyGraph/nodes";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useRoadmapTaskMutations } from "@/hooks/useRoadmapTaskMutations";
import { generateSphinxBountyUrl } from "@/lib/sphinx-tribes";
import { toast } from "sonner";
import type { PhaseWithTickets, TicketListItem } from "@/types/roadmap";
import type { PhaseStatus, TaskStatus, Priority } from "@prisma/client";

export default function PhaseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { slug: workspaceSlug } = useWorkspace();
  const phaseId = params.phaseId as string;

  const fetchPhase = useCallback(async (id: string) => {
    const response = await fetch(`/api/phases/${id}`);
    if (!response.ok) {
      throw new Error("Failed to fetch phase");
    }
    return response.json();
  }, []);

  const {
    data: phase,
    setData: setPhase,
    updateData: updatePhase,
    loading,
    error,
  } = useDetailResource<PhaseWithTickets>({
    resourceId: phaseId,
    fetchFn: fetchPhase,
  });

  // Ticket creation state
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
  const [activeView, setActiveView] = useState<"table" | "graph">("table");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { createTicket, loading: creatingTicket } = useRoadmapTaskMutations();

  // Auto-focus after ticket creation completes
  useEffect(() => {
    if (!creatingTicket && !newTicketTitle && isCreatingTicket) {
      titleInputRef.current?.focus();
    }
  }, [creatingTicket, newTicketTitle, isCreatingTicket]);

  const handleBackClick = () => {
    if (phase?.feature) {
      router.push(`/w/${workspaceSlug}/plan/${phase.feature.id}`);
    } else {
      router.push(`/w/${workspaceSlug}/plan`);
    }
  };

  const handleUpdatePhase = async (field: string, value: string) => {
    if (!phase) return;

    try {
      const response = await fetch(`/api/phases/${phaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

      if (!response.ok) {
        throw new Error("Failed to update phase");
      }

      const result = await response.json();
      if (result.success) {
        updatePhase(result.data);
      }
    } catch (error) {
      console.error("Failed to update phase:", error);
    }
  };

  const handleUpdateStatus = async (status: PhaseStatus) => {
    await handleUpdatePhase("status", status);
  };

  const handleCreateTicket = async () => {
    if (!newTicketTitle.trim() || !phase?.feature) return;

    const ticket = await createTicket({
      featureId: phase.feature.id,
      phaseId,
      title: newTicketTitle,
      description: newTicketDescription || undefined,
      status: newTicketStatus,
      priority: newTicketPriority,
      assigneeId: newTicketAssigneeId,
    });

    if (ticket && phase) {
      // Add new ticket to the list
      setPhase({
        ...phase,
        tasks: [...phase.tasks, ticket],
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

  const handleTicketsReordered = (reorderedTickets: TicketListItem[]) => {
    if (phase) {
      setPhase({
        ...phase,
        tasks: reorderedTickets,
      });
    }
  };

  const handleTicketUpdate = (ticketId: string, updates: Partial<TicketListItem>) => {
    if (phase) {
      setPhase({
        ...phase,
        tasks: phase.tasks.map((t) => (t.id === ticketId ? { ...t, ...updates } : t)),
      });
    }
  };

  const handleDeletePhase = async () => {
    try {
      const response = await fetch(`/api/phases/${phaseId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete phase");
      }

      handleBackClick();
    } catch (error) {
      console.error("Failed to delete phase:", error);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBackClick}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </span>
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-12 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !phase) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={handleBackClick}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold text-red-600">Error</h2>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error || "Phase not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with back button and breadcrumbs */}
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={handleBackClick} className="self-start">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        {phase.feature && (
          <div className="text-sm text-muted-foreground">
            <span
              className="hover:underline cursor-pointer"
              onClick={() => router.push(`/w/${workspaceSlug}/plan/${phase.feature.id}`)}
            >
              {phase.feature.title}
            </span>
            <span className="mx-2">›</span>
            <span>{phase.name}</span>
          </div>
        )}
      </div>

      {/* Phase Details Card */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            {/* Phase Title */}
            <div className="flex items-center gap-4">
              <EditableTitle
                value={phase.name}
                onChange={(value) => updatePhase({ name: value })}
                onBlur={(value) => handleUpdatePhase("name", value)}
                placeholder="Enter phase name..."
                size="large"
              />
            </div>

            {/* Status & Actions */}
            <div className="flex items-center gap-4">
              <StatusPopover statusType="phase" currentStatus={phase.status} onUpdate={handleUpdateStatus} />

              {/* Actions Menu */}
              <ActionMenu
                actions={[
                  {
                    label: "Delete",
                    icon: Trash2,
                    variant: "destructive",
                    confirmation: {
                      title: "Delete Phase",
                      description: `Are you sure you want to delete "${phase.name}"? Any tasks in this phase will be moved to "Unassigned".`,
                      onConfirm: handleDeletePhase,
                    },
                  },
                ]}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Tasks Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Tasks</h3>
              {!isCreatingTicket && (
                <Button onClick={() => setIsCreatingTicket(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Task
                </Button>
              )}
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
                      workspaceSlug={workspaceSlug}
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

            {/* View Toggle Tabs */}
            <Tabs value={activeView} onValueChange={(value) => setActiveView(value as "table" | "graph")}>
              <TabsList>
                <TabsTrigger value="table" className="gap-2">
                  <TableIcon className="h-4 w-4" />
                  Table
                </TabsTrigger>
                <TabsTrigger value="graph" className="gap-2">
                  <Network className="h-4 w-4" />
                  Graph
                </TabsTrigger>
              </TabsList>

              <TabsContent value="table" className="mt-4">
                <RoadmapTasksTable
                  phaseId={phaseId}
                  workspaceSlug={workspaceSlug}
                  tasks={phase.tasks}
                  onTasksReordered={handleTicketsReordered}
                  onTaskUpdate={handleTicketUpdate}
                />
              </TabsContent>

              <TabsContent value="graph" className="mt-4">
                <DependencyGraph
                  entities={phase.tasks}
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
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
