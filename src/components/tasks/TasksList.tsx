"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { TaskCard } from "./TaskCard";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./LoadingState";

interface TasksListProps {
  workspaceId: string;
  workspaceSlug: string;
}

export function TasksList({ workspaceId, workspaceSlug }: TasksListProps) {
  const { tasks, loading, error, pagination, loadMore } = useWorkspaceTasks(workspaceId, true);

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
            Recent Tasks
          </div>
          <span className="text-sm font-normal text-muted-foreground">
            {pagination?.totalCount || tasks.length} task{(pagination?.totalCount || tasks.length) !== 1 ? 's' : ''}
          </span>
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