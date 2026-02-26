"use client";

import { useState } from "react";
import { Calendar, User, Sparkles, Bot, Archive, ArchiveRestore, Server, GitMerge } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { TaskData } from "@/hooks/useWorkspaceTasks";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";
import { DeploymentStatusBadge } from "@/components/tasks/DeploymentStatusBadge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { toast } from "sonner";

interface TaskCardProps {
  task: TaskData;
  workspaceSlug: string;
  hideWorkflowStatus?: boolean;
  isArchived?: boolean;
  onUndoArchive?: () => void;
}

export function TaskCard({ task, workspaceSlug, hideWorkflowStatus = false, isArchived = false, onUndoArchive }: TaskCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Derive task href from conditional logic
  const taskHref = task.status === "TODO" && task.featureId
    ? `/w/${workspaceSlug}/plan/${task.featureId}?tab=tasks`
    : `/w/${workspaceSlug}/task/${task.id}`;

  const handleArchiveToggle = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking archive button
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !isArchived }),
      });

      if (!response.ok) {
        throw new Error("Failed to update task");
      }

      if (!isArchived) {
        toast.success("Task archived", {
          description: task.title,
          style: {
            overflow: "hidden",
          },
          descriptionClassName: "line-clamp-2",
          duration: 5000,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                const res = await fetch(`/api/tasks/${task.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ archived: false }),
                });
                if (!res.ok) throw new Error("Failed to undo archive");
                onUndoArchive?.();
              } catch (error) {
                console.error("Error undoing archive:", error);
                toast.error("Failed to undo archive");
              }
            },
          },
        });
      }
    } catch (error) {
      console.error("Error updating task:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Link href={taskHref} className="block">
      <motion.div
        layout
        data-testid="task-card"
        data-task-id={task.id}
        className="relative p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        whileHover={{ scale: 1.005 }}
        transition={{ duration: 0.15 }}
      >
      {/* Title row */}
      <div className="mb-2 pr-10">
        <AnimatePresence mode="wait">
          <motion.h4
            key={task.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="text-sm font-medium line-clamp-1"
          >
            {task.title}
          </motion.h4>
        </AnimatePresence>
        {task.hasActionArtifact && (
          <Badge className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200 mt-1 inline-block">
            Waiting for input
          </Badge>
        )}
      </div>

      {/* Archive button - absolute positioned top-right (hidden for TODO tasks) */}
      <AnimatePresence>
        {isHovered && task.status !== "TODO" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-3 right-3"
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleArchiveToggle}
                    disabled={isUpdating}
                    className="h-8 w-8 p-0 hover:bg-background/80"
                  >
                    {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isArchived ? "Unarchive" : "Archive"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom metadata row: user | date | status | optional badges */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {/* Assignee - show system assignee if no regular assignee, fallback to createdBy */}
        {task.assignee ? (
          <div className="flex items-center gap-1.5">
            {task.assignee.id.startsWith("system:") ? (
              <Bot className="w-4 h-4 text-blue-600" />
            ) : (
              <Avatar className="size-5">
                <AvatarImage src={task.assignee.image || undefined} />
                <AvatarFallback className="text-xs">
                  <User className="w-3 h-3" />
                </AvatarFallback>
              </Avatar>
            )}
            <span>{task.assignee.name || task.assignee.email}</span>
          </div>
        ) : task.systemAssigneeType === "TASK_COORDINATOR" ? (
          <div className="flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-blue-600" />
            <span>Task Coordinator</span>
          </div>
        ) : task.createdBy ? (
          <div className="flex items-center gap-1.5">
            <Avatar className="size-5">
              <AvatarImage src={task.createdBy.image || undefined} />
              <AvatarFallback className="text-xs">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            <span>{task.createdBy.name || task.createdBy.email}</span>
          </div>
        ) : null}

        {/* Date */}
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{formatRelativeOrDate(task.createdAt)}</span>
        </div>

        {/* Pod indicator - shows when pod is active */}
        {task.podId && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <Server className="w-3 h-3 text-green-600" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Pod active</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Optional: Agent badge */}
        {!hideWorkflowStatus && task.mode === "agent" && (
          <Badge variant="secondary" className="gap-1 h-5">
            <Bot className="w-3 h-3" />
            Agent
          </Badge>
        )}

        {/* Optional: Task Coordinator badge */}
        {!hideWorkflowStatus && task.sourceType === "TASK_COORDINATOR" && (
          <Badge variant="secondary" className="gap-1 h-5 bg-blue-100 text-blue-800 border-blue-200">
            <Bot className="w-3 h-3" />
            Task Coordinator
          </Badge>
        )}

        {/* Optional: Janitor badge */}
        {!hideWorkflowStatus && task.sourceType === "JANITOR" && (
          <Badge variant="secondary" className="gap-1 h-5">
            <Sparkles className="w-3 h-3" />
            Janitor
          </Badge>
        )}

        {/* Workflow Status - hidden when PR artifact exists, workflow is completed, or task is TODO */}
        {/* Agent tasks show "Running" instead of "Pending" since they're active until completion */}
        {!hideWorkflowStatus && !task.prArtifact && task.workflowStatus !== "COMPLETED" && task.status !== "TODO" && (
          <div className="px-2 py-0.5 rounded-full border bg-background text-xs">
            <WorkflowStatusBadge
              status={
                task.mode === "agent" && task.workflowStatus === "PENDING"
                  ? "IN_PROGRESS"
                  : task.workflowStatus
              }
            />
          </div>
        )}

        {/* PR Status Badge */}
        {task.prArtifact && task.prArtifact.content && (
          <PRStatusBadge
            url={task.prArtifact.content.url}
            status={task.prArtifact.content.status}
          />
        )}

        {/* Deployment Status Badge - show when task has deployment status */}
        {task.deploymentStatus && (
          <DeploymentStatusBadge
            environment={task.deploymentStatus as "staging" | "production" | "failed"}
            deploymentUrl={null}
            deployedAt={
              task.deploymentStatus === "production"
                ? task.deployedToProductionAt
                : task.deploymentStatus === "staging"
                ? task.deployedToStagingAt
                : null
            }
          />
        )}

        {/* Auto-merge Badge - only show for open PRs with autoMerge enabled */}
        {task.autoMerge === true && task.prArtifact?.content?.status === 'IN_PROGRESS' && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1 h-5 bg-purple-500/10 text-purple-700 border-purple-500/20">
                  <GitMerge className="h-3 w-3" />
                  Auto-merge
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Will merge automatically when CI passes</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      </motion.div>
    </Link>
  );
}
