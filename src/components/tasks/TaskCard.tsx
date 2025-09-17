"use client";

import { Users, Calendar, User, Sparkles, ExternalLink, MoreHorizontal, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { TaskData } from "@/hooks/useWorkspaceTasks";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface TaskCardProps {
  task: TaskData;
  workspaceSlug: string;
  hideWorkflowStatus?: boolean;
  compactMode?: boolean;
}

export function TaskCard({ task, workspaceSlug, hideWorkflowStatus = false, compactMode = false }: TaskCardProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(`/w/${workspaceSlug}/task/${task.id}`);
  };

  const badges = [];
  if (task.hasActionArtifact) {
    badges.push({ type: 'action', label: 'Waiting for input', icon: AlertCircle, color: 'text-amber-600' });
  }
  if (task.sourceType === "JANITOR") {
    badges.push({ type: 'janitor', label: 'Janitor', icon: Sparkles, color: 'text-purple-600' });
  }
  if (task.stakworkProjectId) {
    badges.push({ type: 'workflow', label: 'Workflow', icon: ExternalLink, color: 'text-blue-600', href: `https://jobs.stakwork.com/admin/projects/${task.stakworkProjectId}` });
  }

  return (
    <TooltipProvider>
      <motion.div
        layout
        className="p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors"
        onClick={handleClick}
        whileHover={{ scale: 1.005 }}
        transition={{ duration: 0.15 }}
      >
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.h4
                key={task.title}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="text-sm font-medium line-clamp-1 flex-1 min-w-0"
              >
                {task.title}
              </motion.h4>
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {compactMode ? (
              <>
                {badges.map((badge) => (
                  badge.href ? (
                    <Tooltip key={badge.type}>
                      <TooltipTrigger asChild>
                        <Link
                          href={badge.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className={`p-1 hover:bg-muted rounded ${badge.color}`}
                        >
                          <badge.icon className="w-4 h-4" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{badge.label}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip key={badge.type}>
                      <TooltipTrigger asChild>
                        <div className={`p-1 ${badge.color}`}>
                          <badge.icon className="w-4 h-4" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{badge.label}</p>
                      </TooltipContent>
                    </Tooltip>
                  )
                ))}
                {badges.length > 2 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {badges.slice(2).map((badge) => (
                        <DropdownMenuItem key={badge.type} asChild={!!badge.href}>
                          {badge.href ? (
                            <Link
                              href={badge.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2"
                            >
                              <badge.icon className="w-4 h-4" />
                              {badge.label}
                            </Link>
                          ) : (
                            <span className="flex items-center gap-2">
                              <badge.icon className="w-4 h-4" />
                              {badge.label}
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {!hideWorkflowStatus && (
                  <div className="px-2 py-1 rounded-full border bg-background text-xs">
                    <WorkflowStatusBadge status={task.workflowStatus} />
                  </div>
                )}
              </>
            ) : (
              <>
                {task.hasActionArtifact && (
                  <Badge className="gap-1 bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                    <AlertCircle className="w-3 h-3" />
                    <span className="hidden sm:inline">Waiting for input</span>
                  </Badge>
                )}
                {task.sourceType === "JANITOR" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="p-1.5 rounded-md text-purple-600 bg-purple-100/80 dark:bg-purple-900/30 dark:text-purple-400">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Janitor</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {task.stakworkProjectId && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`https://jobs.stakwork.com/admin/projects/${task.stakworkProjectId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-md text-blue-600 bg-blue-100/80 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200/80 dark:hover:bg-blue-900/40 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Workflow</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {!hideWorkflowStatus && (
                  <div className="px-2 py-1 rounded-full border bg-background text-xs">
                    <WorkflowStatusBadge status={task.workflowStatus} />
                  </div>
                )}
              </>
            )}
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
      </motion.div>
    </TooltipProvider>
  );
}