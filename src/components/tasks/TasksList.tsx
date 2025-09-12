"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Play } from "lucide-react";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useTaskStats } from "@/hooks/useTaskStats";
import { useWorkspace } from "@/hooks/useWorkspace";
import { TaskCard } from "./TaskCard";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./LoadingState";
import { useEffect } from "react";

interface TasksListProps {
  workspaceId: string;
  workspaceSlug: string;
}

export function TasksList({ workspaceId, workspaceSlug }: TasksListProps) {
  const { waitingForInputCount } = useWorkspace();
  const { tasks, loading, pagination, loadMore, refresh } = useWorkspaceTasks(workspaceId);
  const { stats } = useTaskStats(workspaceId);

  // Refresh task list when global notification count changes
  useEffect(() => {
    refresh();
  }, [waitingForInputCount, refresh]);

  if (loading && tasks.length === 0) {
    return <LoadingState />;
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
            Recent Tasks
          </div>
          <div className="flex items-center gap-4 text-sm">
            {stats?.inProgress && stats.inProgress > 0 && (
              <span className="flex items-center gap-1 font-normal text-green-600">
                <Play className="h-4 w-4" />
                {stats.inProgress} running
              </span>
            )}
            <span className="font-normal text-muted-foreground">
              {stats?.total ?? tasks.length} task{(stats?.total ?? tasks.length) !== 1 ? 's' : ''}
            </span>
          </div>
        </CardTitle>
        <CardDescription>
          Your latest tasks in this workspace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
      </CardContent>
    </Card>
  );
}