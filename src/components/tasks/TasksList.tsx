"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useTaskStats } from "@/hooks/useTaskStats";
import { useWorkspace } from "@/hooks/useWorkspace";
import { TaskCard } from "./TaskCard";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./LoadingState";
import { useEffect, useState } from "react";

interface TasksListProps {
  workspaceId: string;
  workspaceSlug: string;
}

export function TasksList({ workspaceId, workspaceSlug }: TasksListProps) {
  const { waitingForInputCount } = useWorkspace();

  // Archive tab state with localStorage persistence
  const [activeTab, setActiveTab] = useState<"active" | "archived">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tasks-tab-preference");
      return (saved === "archived" ? "archived" : "active") as "active" | "archived";
    }
    return "active";
  });

  // showArchived is true when activeTab is "archived"
  const { tasks, loading, error, pagination, loadMore, refetch } = useWorkspaceTasks(
    workspaceId,
    workspaceSlug,
    true,
    10,
    activeTab === "archived",
  );
  const { stats } = useTaskStats(workspaceId);

  // Save tab preference to localStorage
  const handleTabChange = (value: string) => {
    if (value === "active" || value === "archived") {
      setActiveTab(value);
      localStorage.setItem("tasks-tab-preference", value);
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

  // Only show EmptyState if there are truly no tasks in the workspace (not just in the current tab)
  // Check if both stats total and current tasks are 0, AND we're on the Active tab
  const hasTotallyNoTasks = (stats?.total === 0 || (!stats && tasks.length === 0)) && activeTab === "active";

  if (hasTotallyNoTasks && !loading) {
    return <EmptyState workspaceSlug={workspaceSlug} />;
  }

  return (
    <Card>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <CardHeader>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </CardHeader>

        <CardContent>
          <TabsContent value="active" className="mt-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No active tasks</div>
            ) : (
              <>
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} workspaceSlug={workspaceSlug} isArchived={false} />
                ))}

                {pagination?.hasMore && (
                  <div className="pt-3 border-t flex justify-center">
                    <Button variant="outline" onClick={loadMore} disabled={loading} size="sm">
                      {loading ? "Loading..." : "Load More"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="archived" className="mt-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No archived tasks</div>
            ) : (
              <>
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} workspaceSlug={workspaceSlug} isArchived={true} />
                ))}

                {pagination?.hasMore && (
                  <div className="pt-3 border-t flex justify-center">
                    <Button variant="outline" onClick={loadMore} disabled={loading} size="sm">
                      {loading ? "Loading..." : "Load More"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
