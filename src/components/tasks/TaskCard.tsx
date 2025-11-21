"use client";

import { useState } from "react";
import { Calendar, User, Sparkles, Bot, Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { TaskData } from "@/hooks/useWorkspaceTasks";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/utils";

interface TaskCardProps {
  task: TaskData;
  workspaceSlug: string;
  hideWorkflowStatus?: boolean;
  isArchived?: boolean;
}

export function TaskCard({ task, workspaceSlug, hideWorkflowStatus = false, isArchived = false }: TaskCardProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    router.push(`/w/${workspaceSlug}/task/${task.id}`);
  };

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
    } catch (error) {
      console.error("Error updating task:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <motion.div
      layout
      data-testid="task-card"
      data-task-id={task.id}
      className="relative p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors group"
      onClick={handleClick}
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

      {/* Archive button - absolute positioned top-right */}
      <AnimatePresence>
        {isHovered && (
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
        {/* User */}
        {task.assignee ? (
          <div className="flex items-center gap-1.5">
            <Avatar className="size-5">
              <AvatarFallback className="text-xs">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            <span>{task.assignee.name || task.assignee.email}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Avatar className="size-5">
              <AvatarImage src={task.createdBy.image || undefined} />
              <AvatarFallback className="text-xs">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            <span>{task.createdBy.githubAuth?.githubUsername || task.createdBy.name || task.createdBy.email}</span>
          </div>
        )}

        {/* Date */}
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{formatRelativeTime(task.createdAt)}</span>
        </div>

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

        {/* Workflow Status - hidden when PR artifact exists */}
        {!hideWorkflowStatus && !task.prArtifact && (
          <div className="px-2 py-0.5 rounded-full border bg-background text-xs">
            <WorkflowStatusBadge status={task.workflowStatus} />
          </div>
        )}

        {/* PR Status Badge */}
        {task.prArtifact && task.prArtifact.content && (
          <PRStatusBadge url={task.prArtifact.content.url} status={task.prArtifact.content.status} />
        )}
      </div>
    </motion.div>
  );
}
