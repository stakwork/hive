"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FileText, Play, List, LayoutGrid } from "lucide-react";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useTaskStats } from "@/hooks/useTaskStats";
import { useWorkspace } from "@/hooks/useWorkspace";
import { TaskCard } from "./TaskCard";
import { KanbanView } from "./KanbanView";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./LoadingState";
import { useEffect, useState } from "react";

interface TasksListProps {
  workspaceId: string;
  workspaceSlug: string;
}

export function TasksList({ workspaceId, workspaceSlug }: TasksListProps) {
  const { waitingForInputCount } = useWorkspace();
  
  // View state management with localStorage persistence
  const [viewType, setViewType] = useState<"list" | "kanban">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tasks-view-preference");
      return (saved === "kanban" ? "kanban" : "list") as "list" | "kanban";
    }
    return "list";
  });
  
  // Pass 100 limit for Kanban view, 5 for List view
  const { tasks, loading, error, pagination, loadMore, refetch } = useWorkspaceTasks(
    workspaceId, 
    workspaceSlug, 
    true,
    viewType === "kanban" ? 100 : 5
  );
  const { stats } = useTaskStats(workspaceId);

  // Save view preference to localStorage
  const handleViewChange = (value: string) => {
    if (value === "list" || value === "kanban") {
      setViewType(value);
      localStorage.setItem("tasks-view-preference", value);
    }
  };

  // Refresh task list when global notification count changes
  useEffect(() => {
    refetch();
  }, [waitingForInputCount, refetch]);

  if (loading && tasks.length === 0) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">Error loading tasks</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (tasks.length === 0) {
    return <EmptyState workspaceSlug={workspaceSlug} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {viewType === "list" ? "Recent Tasks" : "Tasks"}
          </div>
          <div className="flex items-center gap-4 text-sm">
            {stats?.inProgress && stats.inProgress > 0 && (
              <span className="flex items-center gap-1 font-normal text-green-600">
                <Play className="h-4 w-4" />
                {stats.inProgress} running
              </span>
            )}
            <span className="font-normal text-muted-foreground">
              {stats?.total ?? pagination?.totalCount ?? tasks.length} task{(stats?.total ?? pagination?.totalCount ?? tasks.length) !== 1 ? 's' : ''}
            </span>
            <ToggleGroup 
              type="single" 
              value={viewType} 
              onValueChange={handleViewChange}
              className="ml-4"
            >
              <ToggleGroupItem 
                value="list" 
                aria-label="List view"
                className="h-8 px-2"
              >
                <List className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="kanban" 
                aria-label="Kanban view"
                className="h-8 px-2"
              >
                <LayoutGrid className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardTitle>
        <CardDescription>
          Your latest tasks in this workspace
        </CardDescription>
      </CardHeader>
      <CardContent className={viewType === "kanban" ? "p-0" : "space-y-3"}>
        {viewType === "list" ? (
          <>
            {tasks.map((task) => (
              <TaskCard 
                key={task.id} 
                task={task} 
                workspaceSlug={workspaceSlug} 
              />
            ))}
            
            {pagination?.hasMore && (
              <div className="pt-3 border-t flex justify-center">
                <Button 
                  variant="outline" 
                  onClick={loadMore}
                  disabled={loading}
                  size="sm"
                >
                  {loading ? "Loading..." : "Load More"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <KanbanView 
            tasks={tasks}
            workspaceSlug={workspaceSlug}
            loading={loading}
          />
        )}
      </CardContent>
    </Card>
  );
}