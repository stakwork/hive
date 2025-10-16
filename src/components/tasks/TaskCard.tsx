"use client";

import { Users, Calendar, User, Sparkles, Bot, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { TaskData } from "@/hooks/useWorkspaceTasks";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/utils";

interface TaskCardProps {
  task: TaskData;
  workspaceSlug: string;
  hideWorkflowStatus?: boolean;
}

export function TaskCard({ task, workspaceSlug, hideWorkflowStatus = false }: TaskCardProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(`/w/${workspaceSlug}/task/${task.id}`);
  };


  return (
    <motion.div
      layout
      data-testid="task-card"
      data-task-id={task.id}
      className="p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors"
      onClick={handleClick}
      whileHover={{ scale: 1.005 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <AnimatePresence mode="wait">
          <motion.h4
            key={task.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="text-sm font-medium line-clamp-1 min-w-0 flex-1"
          >
            {task.title}
          </motion.h4>
        </AnimatePresence>
        {task.hasActionArtifact && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-amber-600" />
              </div>
            </TooltipTrigger>
            <TooltipContent>Waiting for input</TooltipContent>
          </Tooltip>
        )}
      </div>
      
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {task.sourceType === "JANITOR" ? (
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="w-3 h-3" />
            Janitor
          </Badge>
        ) : task.sourceType === "TASK_COORDINATOR" ? (
          <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200">
            <Bot className="w-3 h-3" />
            Task Coordinator
          </Badge>
        ) : task.assignee ? (
          <div className="flex items-center gap-2">
            <Avatar className="size-5">
              <AvatarFallback className="text-xs">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            <span>{task.assignee.name || task.assignee.email}</span>
          </div>
        ) : (
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
        )}
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{formatRelativeTime(task.createdAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}