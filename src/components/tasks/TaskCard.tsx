"use client";

import { Users, Calendar, User, Sparkles, ExternalLink, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { TaskData } from "@/hooks/useWorkspaceTasks";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { formatRelativeTime } from "@/lib/utils";
import { useState, useEffect } from "react";
import { WorkflowStatus } from "@/lib/chat";

interface TaskCardProps {
  task: TaskData;
  workspaceSlug: string;
  onTaskUpdate?: (taskId: string, updates: Partial<TaskData>) => void;
}

export function TaskCard({ task, workspaceSlug, onTaskUpdate }: TaskCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isStoppingTask, setIsStoppingTask] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [localTask, setLocalTask] = useState(task);

  // Sync with parent task prop changes
  useEffect(() => {
    setLocalTask(task);
  }, [task]);

  const handleClick = () => {
    router.push(`/w/${workspaceSlug}/task/${localTask.id}`);
  };

  const handleStopButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click navigation
    e.preventDefault(); // Extra prevention
    
    if (!localTask.stakworkProjectId || localTask.workflowStatus !== "IN_PROGRESS") {
      return;
    }

    setShowStopDialog(true);
  };

  const handleConfirmStop = async () => {
    setIsStoppingTask(true);
    
    try {
      const response = await fetch(`/api/tasks/${localTask.id}/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to stop task:", error);
        toast({
          title: "Error",
          description: `Failed to stop workflow: ${error.error || "Unknown error"}`,
          variant: "destructive",
        });
        return;
      }

      const data = await response.json();
      
      // Update local state
      const updatedTask = {
        ...localTask,
        workflowStatus: WorkflowStatus.CANCELLED,
        workflowCompletedAt: data.task.workflowCompletedAt,
      };
      setLocalTask(updatedTask);
      
      // Call parent update handler if provided
      if (onTaskUpdate) {
        onTaskUpdate(task.id, {
          workflowStatus: WorkflowStatus.CANCELLED,
        });
      }

      toast({
        title: "Success",
        description: "Workflow stopped successfully",
      });
    } catch (error) {
      console.error("Error stopping task:", error);
      toast({
        title: "Error", 
        description: "Failed to stop workflow. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsStoppingTask(false);
    }
  };


  return (
    <>
      <motion.div
        layout
        className="p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors"
        onClick={handleClick}
        whileHover={{ scale: 1.005 }}
        transition={{ duration: 0.15 }}
      >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AnimatePresence mode="wait">
            <motion.h4
              key={localTask.title} // This will trigger re-animation when title changes
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="text-sm font-medium line-clamp-1"
            >
              {localTask.title}
            </motion.h4>
          </AnimatePresence>
          {localTask.hasActionArtifact && (
            <Badge className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200">
              Waiting for input
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {localTask.sourceType === "JANITOR" && (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="w-3 h-3" />
              Janitor
            </Badge>
          )}
          {localTask.stakworkProjectId && (
            <div className="flex items-center gap-1">
              <Link
                href={`https://jobs.stakwork.com/admin/projects/${localTask.stakworkProjectId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors"
              >
                Workflow
                <ExternalLink className="w-3 h-3" />
              </Link>
              {localTask.workflowStatus === WorkflowStatus.IN_PROGRESS && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleStopButtonClick}
                        disabled={isStoppingTask}
                        className="h-6 w-6 p-0 text-red-600 hover:text-red-800 hover:bg-red-50"
                      >
                        <Square className="w-3 h-3 fill-current" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Stop Workflow</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
          <div className="px-2 py-1 rounded-full border bg-background text-xs">
            <WorkflowStatusBadge status={localTask.workflowStatus} />
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Avatar className="size-5">
            <AvatarImage src={localTask.createdBy.image || undefined} />
            <AvatarFallback className="text-xs">
              <User className="w-3 h-3" />
            </AvatarFallback>
          </Avatar>
          <span>
            {localTask.createdBy.githubAuth?.githubUsername || localTask.createdBy.name || localTask.createdBy.email}
          </span>
        </div>
        {localTask.assignee && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{localTask.assignee.name || localTask.assignee.email}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{formatRelativeTime(localTask.createdAt)}</span>
        </div>
      </div>
      </motion.div>

      <ConfirmDialog
        open={showStopDialog}
        onOpenChange={setShowStopDialog}
        title="Stop Workflow"
        description="Are you sure you want to stop this workflow?"
        confirmText="Stop"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleConfirmStop}
      />
    </>
  );
}