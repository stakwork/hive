"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useTaskStats } from "@/hooks/useTaskStats";
import { useWorkspace } from "@/hooks/useWorkspace";
import { TaskCard } from "./TaskCard";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./LoadingState";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { TaskFilters, TaskFiltersType } from "./TaskFilters";

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

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Filter state
  const [filters, setFilters] = useState<TaskFiltersType>({});

  // showArchived is true when activeTab is "archived"
  const { tasks, loading, error, pagination, loadMore, refetch } = useWorkspaceTasks(
    workspaceId,
    workspaceSlug,
    true,
    10,
    activeTab === "archived",
    debouncedSearchQuery,
    filters
  );
  const { stats } = useTaskStats(workspaceId);

  // Save tab preference to localStorage
  const handleTabChange = (value: string) => {
    if (value === "active" || value === "archived") {
      setActiveTab(value);
      localStorage.setItem("tasks-tab-preference", value);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleFiltersChange = (newFilters: TaskFiltersType) => {
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({});
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
          {/* Filters and Search Bar */}
          <div className="flex items-center gap-2 mb-4">
            <TaskFilters
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onClearFilters={handleClearFilters}
            />
            <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            </div>
          </div>

          <TabsContent value="active" className="mt-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No active tasks
              </div>
            ) : (
              <>
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    workspaceSlug={workspaceSlug}
                    isArchived={false}
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
            )}
          </TabsContent>

          <TabsContent value="archived" className="mt-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No archived tasks
              </div>
            ) : (
              <>
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    workspaceSlug={workspaceSlug}
                    isArchived={true}
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
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
