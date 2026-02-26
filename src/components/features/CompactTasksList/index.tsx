"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { TaskStatus } from "@prisma/client";
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
  const [assigningTasks, setAssigningTasks] = useState(false);

  const defaultPhase = feature.phases?.[0];

  const tasks = useMemo(() => {
    return [...((defaultPhase?.tasks || []) as TaskWithPrArtifact[])].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [defaultPhase?.tasks]);

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
              ...(update.workflowStatus !== undefined && { workflowStatus: update.workflowStatus }),
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

  const handleBulkAssignTasks = async () => {
    if (assigningTasks) return;
    setAssigningTasks(true);
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
          description: "Processing begins when a machine is available",
        });
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

      <div className="space-y-1.5">
        {tasks.map((task) => {
          const prArtifact = task.prArtifact;
          const isDimmed = task.status === "DONE" || task.status === "CANCELLED";
          const deployedAtRaw = task.deploymentStatus === "production"
            ? task.deployedToProductionAt
            : task.deployedToStagingAt;

          const actionMenuItems: ActionMenuItem[] = [
            {
              label: "View Task",
              icon: ExternalLink,
              variant: "default" as const,
              onClick: () => router.push(`/w/${workspaceSlug}/task/${task.id}`),
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

          return (
            <div
              key={task.id}
              className="rounded-md border px-3 py-2 hover:bg-muted/40 cursor-pointer transition-colors"
              onClick={() => router.push(`/w/${workspaceSlug}/task/${task.id}`)}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[task.status] || "bg-zinc-400"}`} />
                <span
                  className={`text-sm truncate flex-1 min-w-0 ${isDimmed ? "line-through text-muted-foreground" : ""}`}
                >
                  {task.title}
                </span>
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
                      <SelectTrigger className="h-5 text-[10px] px-1.5 py-0 w-auto max-w-[100px] border-muted bg-muted/50 gap-1 [&>svg]:h-3 [&>svg]:w-3">
                        <SelectValue />
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
