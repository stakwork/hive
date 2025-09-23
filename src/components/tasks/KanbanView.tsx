"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { TaskData } from "@/hooks/useWorkspaceTasks";
import { TaskCard } from "./TaskCard";
import { WorkflowStatus } from "@prisma/client";
import { Loader2, CheckCircle, AlertCircle, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

interface KanbanViewProps {
  tasks: TaskData[];
  workspaceSlug: string;
  loading?: boolean;
}

interface KanbanColumn {
  status: WorkflowStatus;
  title: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const kanbanColumns: KanbanColumn[] = [
  {
    status: WorkflowStatus.IN_PROGRESS,
    title: "In Progress",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50/30 dark:bg-blue-950/10",
  },
  {
    status: WorkflowStatus.COMPLETED,
    title: "Completed",
    icon: <CheckCircle className="h-4 w-4" />,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50/30 dark:bg-green-950/10",
  },
  {
    status: WorkflowStatus.ERROR,
    title: "Error",
    icon: <AlertCircle className="h-4 w-4" />,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50/30 dark:bg-red-950/10",
  },
  {
    status: WorkflowStatus.HALTED,
    title: "Halted",
    icon: <Pause className="h-4 w-4" />,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50/30 dark:bg-orange-950/10",
  },
];

// Map status to normalize PENDING -> IN_PROGRESS and FAILED -> ERROR
const normalizeStatus = (status: WorkflowStatus): WorkflowStatus => {
  if (status === WorkflowStatus.PENDING) return WorkflowStatus.IN_PROGRESS;
  if (status === WorkflowStatus.FAILED) return WorkflowStatus.ERROR;
  return status;
};

// Sort tasks with waiting for input first, then by most recent
const sortTasks = (tasks: TaskData[]): TaskData[] => {
  return [...tasks].sort((a, b) => {
    if (a.hasActionArtifact !== b.hasActionArtifact) {
      return a.hasActionArtifact ? -1 : 1;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
};

interface ColumnProps {
  column: KanbanColumn;
  tasks: TaskData[];
  workspaceSlug: string;
  className?: string;
}

function KanbanColumn({ column, tasks, workspaceSlug, className }: ColumnProps) {
  const sortedTasks = sortTasks(tasks);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Column Header */}
      <div className={cn(
        "rounded-t-lg px-4 py-3 border-x border-t",
        column.bgColor
      )}>
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center gap-2 text-sm font-semibold", column.color)}>
            {column.icon}
            <span>{column.title}</span>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "text-xs font-medium px-2 py-0.5",
              tasks.length > 0 && "bg-background"
            )}
          >
            {tasks.length}
          </Badge>
        </div>
      </div>

      {/* Column Content */}
      <div className="flex-1 bg-muted/20 rounded-b-lg border-x border-b p-3 space-y-2 overflow-y-auto min-h-[100px] md:max-h-[calc(100vh-300px)]">
        {sortedTasks.length > 0 ? (
          sortedTasks.map((task) => (
            <div key={task.id} className="bg-background rounded-lg shadow-sm">
              <TaskCard
                task={task}
                workspaceSlug={workspaceSlug}
                hideWorkflowStatus={true}
                compactMode={true}
              />
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-20 md:h-32 text-sm text-muted-foreground/60 italic">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanView({ tasks, workspaceSlug, loading }: KanbanViewProps) {
  // Group tasks by normalized workflow status
  const tasksByStatus = tasks.reduce((acc, task) => {
    const status = normalizeStatus(task.workflowStatus || WorkflowStatus.IN_PROGRESS);
    if (!acc[status]) {
      acc[status] = [];
    }
    acc[status].push(task);
    return acc;
  }, {} as Record<WorkflowStatus, TaskData[]>);

  return (
    <div className="w-full p-4">
      {/* Mobile view - stacked columns */}
      <div className="md:hidden space-y-4">
        {kanbanColumns.map((column) => (
          <KanbanColumn
            key={column.status}
            column={column}
            tasks={tasksByStatus[column.status] || []}
            workspaceSlug={workspaceSlug}
            className="w-full"
          />
        ))}
      </div>

      {/* Desktop view - horizontal scrollable */}
      <ScrollArea className="hidden md:block w-full whitespace-nowrap">
        <div className="flex gap-4 pb-4 min-h-[500px]">
          {kanbanColumns.map((column) => (
            <KanbanColumn
              key={column.status}
              column={column}
              tasks={tasksByStatus[column.status] || []}
              workspaceSlug={workspaceSlug}
              className="flex-shrink-0 w-[340px]"
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="mt-2" />
      </ScrollArea>
    </div>
  );
}