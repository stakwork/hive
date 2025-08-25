"use client";

import { Users, Calendar, User, Sparkles, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TaskData } from "@/hooks/useWorkspaceTasks";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";

interface TaskCardProps {
  task: TaskData;
  workspaceSlug: string;
}

export function TaskCard({ task, workspaceSlug }: TaskCardProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(`/w/${workspaceSlug}/task/${task.id}`);
  };


  return (
    <div
      className="p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors"
      onClick={handleClick}
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium line-clamp-1">
          {task.title}
        </h4>
        <div className="flex items-center gap-2">
          {task.sourceType === "JANITOR" && (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="w-3 h-3" />
              Janitor
            </Badge>
          )}
          {task.stakworkProjectId && (
            <Link
              href={`https://jobs.stakwork.com/admin/projects/${task.stakworkProjectId}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors"
            >
              Project
              <ExternalLink className="w-3 h-3" />
            </Link>
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
    </div>
  );
}