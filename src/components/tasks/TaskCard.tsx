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
import { useState } from "react";
import { WorkflowStatus } from "@/lib/chat";

interface TaskCardProps {
  task: TaskData;
  workspaceSlug: string;
}

export function TaskCard({ task, workspaceSlug }: TaskCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isStoppingTask, setIsStoppingTask] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);

  const handleClick = () => {
    router.push(`/w/${workspaceSlug}/task/${task.id}`);
  };

  const handleStopButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click navigation
    
    if (!task.stakworkProjectId || task.workflowStatus !== "IN_PROGRESS") {
      return;
    }

    setShowStopDialog(true);
  };

  const handleConfirmStop = async () => {
    setIsStoppingTask(true);
    
    try {
      const response = await fetch(`/api/tasks/${task.id}/stop`, {
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

      toast({
        title: "Success",
        description: "Workflow stopped successfully",
      });

      // Refresh the page to show updated status
      window.location.reload();
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
              key={task.title} // This will trigger re-animation when title changes
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
            <Badge className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200">
              Waiting for input
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {task.sourceType === "JANITOR" && (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="w-3 h-3" />
              Janitor
            </Badge>
          )}
          {task.stakworkProjectId && (
            <div className="flex items-center gap-1">
              <Link
                href={`https://jobs.stakwork.com/admin/projects/${task.stakworkProjectId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors"
              >
                Workflow
                <ExternalLink className="w-3 h-3" />
              </Link>
              {task.workflowStatus === WorkflowStatus.IN_PROGRESS && (
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
              )}
            </div>
          )}
          <div className="px-2 py-1 rounded-full border bg-background text-xs">
            <WorkflowStatusBadge status={task.workflowStatus} />
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Avatar className="size-5">
            <AvatarImage src={task.createdBy.image || undefined} />
            <AvatarFallback className="text-xs">
              <User className="w-3 h-3" />
            </AvatarFallback>
          </Avatar>
          <span>
            {task.createdBy.githubAuth?.githubUsername || task.createdBy.name || task.createdBy.email}
          </span>
        </div>
        {task.assignee && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{task.assignee.name || task.assignee.email}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{formatRelativeTime(task.createdAt)}</span>
        </div>
      </div>

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
    </motion.div>
  );
}