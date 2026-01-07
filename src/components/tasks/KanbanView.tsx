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
    color: "text-yellow-600 dark:text-yellow-400",
    bgColor: "bg-yellow-50/30 dark:bg-yellow-950/10",
  },
];

export function KanbanView({ tasks, workspaceSlug }: KanbanViewProps) {
  // Group tasks by workflow status - PENDING goes to IN_PROGRESS, FAILED goes to ERROR
  const tasksByStatus = tasks.reduce((acc, task) => {
    let status = task.workflowStatus || WorkflowStatus.IN_PROGRESS;
    // Merge PENDING tasks into IN_PROGRESS column
    if (status === WorkflowStatus.PENDING) {
      status = WorkflowStatus.IN_PROGRESS;
    }
    // Merge FAILED tasks into ERROR column
    if (status === WorkflowStatus.FAILED) {
      status = WorkflowStatus.ERROR;
    }
    if (!acc[status]) {
      acc[status] = [];
    }
    acc[status].push(task);
    return acc;
  }, {} as Record<WorkflowStatus, TaskData[]>);

  // Sort tasks within each column - bubble "waiting for input" to the top
  Object.keys(tasksByStatus).forEach((status) => {
    tasksByStatus[status as WorkflowStatus].sort((a, b) => {
      // First priority: waiting for input tasks
      if (a.hasActionArtifact && !b.hasActionArtifact) return -1;
      if (!a.hasActionArtifact && b.hasActionArtifact) return 1;
      
      // Second priority: most recent first
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });

  return (
    <div className="w-full p-4">
      {/* Mobile view - stacked columns */}
      <div className="md:hidden space-y-4">
        {kanbanColumns.map((column) => {
          const columnTasks = tasksByStatus[column.status] || [];
          
          return (
            <div key={column.status} className="w-full">
              <div className={cn(
                "rounded-t-lg px-4 py-3 border-x border-t",
                column.bgColor,
                "border-b-0"
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
                      columnTasks.length > 0 && "bg-background"
                    )}
                  >
                    {columnTasks.length}
                  </Badge>
                </div>
              </div>
              <div className="bg-muted/20 rounded-b-lg border-x border-b p-3 space-y-2 min-h-[100px]">
                {columnTasks.length > 0 ? (
                  columnTasks.map((task) => (
                    <div key={task.id} className="bg-background rounded-lg shadow-sm">
                      <TaskCard
                        task={task}
                        workspaceSlug={workspaceSlug}
                        hideWorkflowStatus={true}
                      />
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center h-20 text-sm text-muted-foreground/60 italic">
                    No tasks
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop view - horizontal scrollable */}
      <ScrollArea className="hidden md:block w-full whitespace-nowrap">
        <div className="flex gap-4 pb-4 min-h-[500px]">
          {kanbanColumns.map((column) => {
            const columnTasks = tasksByStatus[column.status] || [];
            
            return (
              <div 
                key={column.status} 
                className="flex-shrink-0 w-[340px]"
              >
                <div className="flex flex-col h-full">
                  <div className={cn(
                    "rounded-t-lg px-4 py-3 border-x border-t",
                    column.bgColor,
                    "border-b-0"
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
                          columnTasks.length > 0 && "bg-background"
                        )}
                      >
                        {columnTasks.length}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex-1 bg-muted/20 rounded-b-lg border-x border-b p-3 space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto">
                    {columnTasks.length > 0 ? (
                      columnTasks.map((task) => (
                        <div key={task.id} className="bg-background rounded-lg shadow-sm">
                          <TaskCard
                            task={task}
                            workspaceSlug={workspaceSlug}
                            hideWorkflowStatus={true}
                          />
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground/60 italic">
                        No tasks
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" className="mt-2" />
      </ScrollArea>
    </div>
  );
}
