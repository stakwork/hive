"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, Play, Trash2, RefreshCw, FolderOpen, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { DependencyGraph } from "@/components/features/DependencyGraph";
import { RoadmapTaskNode } from "@/components/features/DependencyGraph/nodes";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";
import { DeploymentStatusBadge } from "@/components/tasks/DeploymentStatusBadge";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useRoadmapTaskMutations } from "@/hooks/useRoadmapTaskMutations";
import { usePusherConnection, type TaskTitleUpdateEvent, type DeploymentStatusChangeEvent } from "@/hooks/usePusherConnection";
import type { FeatureDetail, PrArtifact } from "@/types/roadmap";
import type { TaskStatus, WorkflowStatus } from "@prisma/client";
import { toast } from "sonner";

type TaskWithPrArtifact = FeatureDetail["phases"][0]["tasks"][0] & {
  prArtifact?: PrArtifact;
};

const STATUS_DOT: Record<string, string> = {
  TODO: "bg-zinc-400",
  IN_PROGRESS: "bg-amber-500",
  DONE: "bg-emerald-500",
  CANCELLED: "bg-red-400",
  BLOCKED: "bg-orange-500",
};

interface CompactTasksListProps {
  featureId: string;
  feature: FeatureDetail;
  onUpdate: (feature: FeatureDetail) => void;
  isGenerating?: boolean;
}

function MiniToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={[
        "relative inline-flex items-center shrink-0 rounded-full border transition-colors h-4 w-7",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        checked ? "bg-emerald-500 border-emerald-500" : "bg-muted border-border",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none block rounded-full bg-white shadow-sm transition-transform h-3 w-3",
          checked ? "translate-x-3" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

export function CompactTasksList({ featureId, feature, onUpdate, isGenerating }: CompactTasksListProps) {
  const router = useRouter();
  const { slug: workspaceSlug, workspace } = useWorkspace();
  const { updateTicket } = useRoadmapTaskMutations();
  const isMobile = useIsMobile();
  const [graphOpen, setGraphOpen] = useState(false);
  const [assigningTasks, setAssigningTasks] = useState(false);
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [duplicatingTaskId, setDuplicatingTaskId] = useState<string | null>(null);
  const [queueStats, setQueueStats] = useState<{ queuedCount: number; unusedVms: number } | null>(null);

  const defaultPhase = feature.phases?.[0];

  const tasks = useMemo(() => {
    return [...((defaultPhase?.tasks || []) as TaskWithPrArtifact[])].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [defaultPhase?.tasks]);

  const hasDependencies = useMemo(
    () => tasks.some((t) => (t.dependsOnTaskIds ?? []).length > 0),
    [tasks]
  );

  const workspaceRepos = useMemo(
    () =>
      (workspace?.repositories || []).map((r) => ({
        id: r.id,
        name: r.name,
      })),
    [workspace?.repositories]
  );
  const showRepoSelector = workspaceRepos.length > 1;

  const startableTasks = tasks.filter((task) => !task.assignee && task.status === "TODO");

  const cancelledCount = tasks.filter((t) => t.status === "CANCELLED").length;
  const activeTotal = tasks.length - cancelledCount;
  const doneCount = tasks.filter((t) => t.status === "DONE").length;
  const inProgressCount = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const totalCount = tasks.length;
  const completePercent = activeTotal > 0 ? Math.round((doneCount / activeTotal) * 100) : 0;

  const handleRealtimeTaskUpdate = useCallback(
    (update: TaskTitleUpdateEvent) => {
      if (!feature.phases) return;
      const updatedPhases = feature.phases.map((phase) => ({
        ...phase,
        tasks: phase.tasks.map((task) => {
          if (task.id === update.taskId) {
            return {
              ...task,
              ...(update.newTitle !== undefined && { title: update.newTitle }),
              ...(update.status !== undefined && { status: update.status as TaskStatus }),
              ...(update.workflowStatus !== undefined && { workflowStatus: update.workflowStatus as WorkflowStatus | null }),
            };
          }
          return task;
        }),
      }));
      onUpdate({ ...feature, phases: updatedPhases });
    },
    [feature, onUpdate]
  );

  const handlePRStatusChange = useCallback(
    (event: { taskId: string; state: string; artifactStatus?: string }) => {
      if (!feature) return;
      const updatedFeature = {
        ...feature,
        phases: feature.phases.map((phase) => ({
          ...phase,
          tasks: phase.tasks.map((task) => {
            if (task.id !== event.taskId) return task;
            const updatedTask = { ...task };
            if (event.artifactStatus === "DONE") {
              updatedTask.status = "DONE";
            }
            return updatedTask;
          }),
        })),
      };
      onUpdate(updatedFeature);
    },
    [feature, onUpdate]
  );

  const handleDeploymentStatusChange = useCallback(
    (event: DeploymentStatusChangeEvent) => {
      if (!feature) return;
      const updatedFeature = {
        ...feature,
        phases: feature.phases.map((phase) => ({
          ...phase,
          tasks: phase.tasks.map((task) => {
            if (task.id !== event.taskId) return task;
            const updatedTask = { ...task };
            updatedTask.deploymentStatus = event.deploymentStatus;
            if (event.environment === "staging") {
              updatedTask.deployedToStagingAt = event.deployedAt ? new Date(event.deployedAt) : null;
            } else if (event.environment === "production") {
              updatedTask.deployedToProductionAt = event.deployedAt ? new Date(event.deployedAt) : null;
            }
            return updatedTask;
          }),
        })),
      };
      onUpdate(updatedFeature);
    },
    [feature, onUpdate]
  );

  usePusherConnection({
    workspaceSlug,
    enabled: !!workspaceSlug,
    onTaskTitleUpdate: handleRealtimeTaskUpdate,
    onPRStatusChange: handlePRStatusChange,
    onDeploymentStatusChange: handleDeploymentStatusChange,
  });

  const handleUpdateTask = async (
    taskId: string,
    updates: { status?: TaskStatus; autoMerge?: boolean; repositoryId?: string | null }
  ) => {
    const updatedTask = await updateTicket({ taskId, updates });
    if (updatedTask && defaultPhase) {
      const updatedPhases = feature.phases.map((phase) => {
        if (phase.id === defaultPhase.id) {
          return {
            ...phase,
            tasks: phase.tasks.map((task) =>
              task.id === taskId ? { ...task, ...updatedTask } : task
            ),
          };
        }
        return phase;
      });
      onUpdate({ ...feature, phases: updatedPhases });
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tickets/${taskId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete task");
      if (defaultPhase) {
        const updatedPhases = feature.phases.map((phase) => {
          if (phase.id === defaultPhase.id) {
            return {
              ...phase,
              tasks: phase.tasks.filter((t) => t.id !== taskId),
            };
          }
          return phase;
        });
        onUpdate({ ...feature, phases: updatedPhases });
      }
    } catch (error) {
      console.error("Failed to delete task:", error);
    }
  };

  const handleStartTask = async (taskId: string) => {
    if (startingTaskId) return;
    setStartingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startWorkflow: true }),
      });
      if (!response.ok) throw new Error("Failed to start task");
      // Pusher real-time updates handle the visual status transition automatically
    } catch (error) {
      console.error("Failed to start task:", error);
      toast.error("Failed to start task");
    } finally {
      setStartingTaskId(null);
    }
  };

  const handleDuplicateTask = async (task: TaskWithPrArtifact) => {
    if (duplicatingTaskId) return;
    setDuplicatingTaskId(task.id);
    try {
      const response = await fetch(`/api/features/${featureId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description ?? undefined,
          phaseId: task.phaseId ?? undefined,
          repositoryId: task.repository?.id ?? undefined,
          priority: task.priority,
          status: "TODO",
          autoMerge: false,
        }),
      });
      if (!response.ok) throw new Error("Failed to duplicate task");
      const result = await response.json();
      if (result.success && defaultPhase) {
        const updatedPhases = feature.phases.map((phase) => {
          if (phase.id === defaultPhase.id) {
            return {
              ...phase,
              tasks: [...phase.tasks, result.data],
            };
          }
          return phase;
        });
        onUpdate({ ...feature, phases: updatedPhases });
        toast.success("Task duplicated");
      }
    } catch (error) {
      console.error("Failed to duplicate task:", error);
      toast.error("Failed to duplicate task");
    } finally {
      setDuplicatingTaskId(null);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    if (retryingTaskId) return;
    setRetryingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryWorkflow: true }),
      });
      if (!response.ok) throw new Error("Failed to retry task");
      
      // Refresh feature data to get updated workflowStatus
      const featureResponse = await fetch(`/api/features/${featureId}`);
      const featureResult = await featureResponse.json();
      if (featureResult.success) {
        onUpdate(featureResult.data);
      }
    } catch (error) {
      console.error("Failed to retry task:", error);
      toast.error("Failed to retry task");
    } finally {
      setRetryingTaskId(null);
    }
  };

  const handleBulkAssignTasks = async () => {
    if (assigningTasks) return;
    setAssigningTasks(true);
    setQueueStats(null);
    try {
      const response = await fetch(`/api/features/${featureId}/tasks/assign-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to assign tasks");
      if (result.count === 0) {
        toast.info("All tasks already assigned");
      } else {
        toast.info("Tasks queued for coordinator", {
          description: "Processing begins when a pod is available",
        });
        if (workspaceSlug) {
          const statusResponse = await fetch(`/api/w/${workspaceSlug}/pool/status`);
          if (statusResponse.ok) {
            const statusResult = await statusResponse.json();
            if (statusResult.success && statusResult.data?.status) {
              const { queuedCount, unusedVms } = statusResult.data.status;
              setQueueStats({ queuedCount, unusedVms });
            }
          }
        }
      }
      const featureResponse = await fetch(`/api/features/${featureId}`);
      const featureResult = await featureResponse.json();
      if (featureResult.success) onUpdate(featureResult.data);
    } catch (error) {
      console.error("Failed to bulk assign tasks:", error);
      const message = error instanceof Error ? error.message : "Failed to assign tasks";
      toast.error(message);
    } finally {
      setAssigningTasks(false);
    }
  };

  if (!defaultPhase || (tasks.length === 0 && !isGenerating)) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No tasks yet.
      </div>
    );
  }

  if (tasks.length === 0 && isGenerating) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground gap-2">
        <span className="animate-spin h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full" />
        Generating tasks...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{doneCount} of {activeTotal} complete</span>
          <span className="tabular-nums">{completePercent}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
          {doneCount > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${(doneCount / totalCount) * 100}%` }}
            />
          )}
          {inProgressCount > 0 && (
            <div
              className="h-full bg-amber-500 transition-all duration-500"
              style={{ width: `${(inProgressCount / totalCount) * 100}%` }}
            />
          )}
        </div>
      </div>

      {hasDependencies && (
        <Collapsible open={graphOpen} onOpenChange={setGraphOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="font-medium">Dependencies</span>
                <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none">
                  {tasks.filter((t) => (t.dependsOnTaskIds ?? []).length > 0).length}
                </span>
              </div>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${graphOpen ? "rotate-180" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <DependencyGraph
              entities={tasks}
              getDependencies={(t) => t.dependsOnTaskIds ?? []}
              renderNode={(t) => <RoadmapTaskNode data={t} direction="TB" />}
              direction="TB"
              onNodeClick={(taskId) => {
                const task = tasks.find((t) => t.id === taskId);
                if (task) {
                  const route =
                    task.status === "IN_PROGRESS" || task.status === "DONE"
                      ? `/w/${workspaceSlug}/task/${task.id}`
                      : `/w/${workspaceSlug}/tickets/${task.id}`;
                  router.push(route);
                }
              }}
              className={isMobile ? "h-[280px]" : "h-[380px]"}
              open={graphOpen}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {startableTasks.length > 0 && (
        <Button
          onClick={handleBulkAssignTasks}
          size="sm"
          variant="outline"
          className="w-full"
          disabled={assigningTasks}
        >
          {assigningTasks ? (
            "Running..."
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-1.5 text-green-600" />
              Start {startableTasks.length} task{startableTasks.length !== 1 ? "s" : ""}
            </>
          )}
        </Button>
      )}

      {queueStats !== null && queueStats.queuedCount > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {queueStats.queuedCount} {queueStats.queuedCount === 1 ? "task" : "tasks"} in workspace queue · {queueStats.unusedVms} pod{queueStats.unusedVms !== 1 ? "s" : ""} available
        </p>
      )}

      <div className="space-y-1.5">
        {tasks.map((task) => {
          const prArtifact = task.prArtifact;
          const isDimmed = task.status === "DONE" || task.status === "CANCELLED";
          const isQueued = task.status === "TODO" && task.systemAssigneeType === "TASK_COORDINATOR";
          const deployedAtRaw = task.deploymentStatus === "production"
            ? task.deployedToProductionAt
            : task.deployedToStagingAt;

          const getTaskRoute = (task: TaskWithPrArtifact) => {
            if (task.status === 'IN_PROGRESS' || task.status === 'DONE') {
              return `/w/${workspaceSlug}/task/${task.id}`;
            }
            return `/w/${workspaceSlug}/tickets/${task.id}`;
          };

          const actionMenuItems: ActionMenuItem[] = [
            {
              label: "View Task",
              icon: ExternalLink,
              variant: "default" as const,
              onClick: () => router.push(getTaskRoute(task)),
            },
            {
              label: "Duplicate",
              icon: Copy,
              variant: "default" as const,
              disabled: duplicatingTaskId === task.id,
              onClick: () => handleDuplicateTask(task),
            },
            {
              label: "Delete",
              icon: Trash2,
              variant: "destructive" as const,
              confirmation: {
                title: "Delete Task",
                description: `Are you sure you want to delete "${task.title}"? This action cannot be undone.`,
                onConfirm: () => handleDeleteTask(task.id),
              },
            },
          ];

          if (task.status === "TODO") {
            actionMenuItems.unshift({
              label: "Start Task",
              icon: Play,
              variant: "default",
              disabled: startingTaskId === task.id,
              onClick: () => handleStartTask(task.id),
              separator: true,
            });
          }

          const isTerminalWorkflow = ['ERROR', 'FAILED', 'HALTED'].includes(task.workflowStatus ?? '');
          const isRetrying = retryingTaskId === task.id;

          return (
            <div
              key={task.id}
              className="rounded-md border px-3 py-2 hover:bg-muted/40 cursor-pointer transition-colors"
              onClick={() => router.push(getTaskRoute(task))}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${isQueued ? "bg-blue-500 animate-pulse" : STATUS_DOT[task.status] || "bg-zinc-400"}`} />
                <span
                  className={`text-sm truncate flex-1 min-w-0 ${isDimmed ? "line-through text-muted-foreground" : ""}`}
                >
                  {task.title}
                </span>
                {isQueued && (
                  <span className="text-xs text-blue-500 font-medium shrink-0">
                    Queued
                  </span>
                )}
                {task.deploymentStatus && (
                  <DeploymentStatusBadge
                    environment={task.deploymentStatus as "staging" | "production"}
                    deployedAt={deployedAtRaw ? new Date(deployedAtRaw) : undefined}
                  />
                )}
                {prArtifact && (
                  <PRStatusBadge
                    url={prArtifact.content.url}
                    status={prArtifact.content.status}
                  />
                )}
                {isTerminalWorkflow && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRetryTask(task.id);
                    }}
                    disabled={isRetrying}
                    className="h-6 w-6 shrink-0"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                  </Button>
                )}
                <ActionMenu
                  actions={actionMenuItems}
                  triggerSize="icon"
                  triggerVariant="ghost"
                />
              </div>

              <div className="flex items-center gap-3 mt-1.5 pl-[18px] text-[10px] text-muted-foreground">
                {showRepoSelector && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={task.repository?.id || workspaceRepos[0]?.id || ""}
                      onValueChange={(value) =>
                        handleUpdateTask(task.id, { repositoryId: value })
                      }
                      disabled={task.status !== "TODO"}
                    >
                      <SelectTrigger className="h-5 text-[10px] px-1.5 py-0 w-auto max-w-[120px] border-muted bg-muted/50 gap-1 [&>svg]:h-3 [&>svg]:w-3">
                        <div className="flex items-center gap-1 overflow-hidden min-w-0">
                          <FolderOpen className="h-3 w-3 shrink-0" />
                          <span className="truncate min-w-0 block"><SelectValue /></span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {workspaceRepos.map((repo) => (
                          <SelectItem key={repo.id} value={repo.id} className="text-xs">
                            {repo.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div
                  className="flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MiniToggle
                    checked={task.autoMerge ?? false}
                    onChange={(autoMerge) => handleUpdateTask(task.id, { autoMerge })}
                    disabled={task.status !== "TODO"}
                  />
                  <span>auto-merge</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
