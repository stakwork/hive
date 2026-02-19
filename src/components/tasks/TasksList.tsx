"use client";

import React, { useEffect, useState } from "react";
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
import { Search, X, List, LayoutGrid, ArrowUpDown } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { TaskFilters, TaskFiltersType } from "./TaskFilters";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KanbanView } from "@/components/ui/kanban-view";
import { TASK_KANBAN_COLUMNS } from "@/types/roadmap";
import { TaskStatus } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  // View type state with localStorage persistence
  const [viewType, setViewType] = useState<"list" | "kanban">(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tasks-view-preference") === "kanban" ? "kanban" : "list";
    }
    return "list";
  });

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Filter state
  const [filters, setFilters] = useState<TaskFiltersType>({});

  // Sort state with localStorage persistence
  type SortOption = "updatedDesc" | "updatedAsc" | "createdDesc" | "createdAsc";
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tasks-sort-preference");
      return (saved as SortOption) || "updatedDesc";
    }
    return "updatedDesc";
  });

  // Use larger page limit for Kanban view to load more items at once
  const pageLimit = viewType === "kanban" ? 100 : 10;

  // Map sort options to API parameters
  const getSortParams = (sortOption: SortOption) => {
    switch (sortOption) {
      case "updatedDesc":
        return { sortBy: "updatedAt", sortOrder: "desc" };
      case "updatedAsc":
        return { sortBy: "updatedAt", sortOrder: "asc" };
      case "createdDesc":
        return { sortBy: "createdAt", sortOrder: "desc" };
      case "createdAsc":
        return { sortBy: "createdAt", sortOrder: "asc" };
      default:
        return { sortBy: "updatedAt", sortOrder: "desc" };
    }
  };

  const { sortBy: apiSortBy, sortOrder: apiSortOrder } = getSortParams(sortBy);

  // showArchived is true when activeTab is "archived"
  // showAllStatuses is true when in Kanban view (to show TODO tasks)
  const { tasks, loading, error, pagination, loadMore, refetch } = useWorkspaceTasks(
    workspaceId,
    workspaceSlug,
    true,
    pageLimit,
    activeTab === "archived",
    debouncedSearchQuery,
    filters,
    viewType === "kanban",
    apiSortBy,
    apiSortOrder
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

  const handleViewChange = (value: string) => {
    if (value === "list" || value === "kanban") {
      setViewType(value);
      localStorage.setItem("tasks-view-preference", value);
    }
  };

  const handleSortChange = (value: SortOption) => {
    setSortBy(value);
    localStorage.setItem("tasks-sort-preference", value);
  };

  // Tasks are now sorted by the backend API, no need for client-side sorting
  const sortedTasks = tasks;

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
    <Card data-testid="tasks-list-loaded">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
          <ToggleGroup type="single" value={viewType} onValueChange={handleViewChange}>
            <ToggleGroupItem value="list" aria-label="List view" className="h-8 px-2">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="kanban" aria-label="Kanban view" className="h-8 px-2">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>

        <CardContent>
          {/* Filters, Search Bar, and Sort */}
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
            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger className="w-[200px]" data-testid="sort-select">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedDesc" data-testid="sort-updated-desc">
                  Updated (Newest)
                </SelectItem>
                <SelectItem value="updatedAsc" data-testid="sort-updated-asc">
                  Updated (Oldest)
                </SelectItem>
                <SelectItem value="createdDesc" data-testid="sort-created-desc">
                  Created (Newest)
                </SelectItem>
                <SelectItem value="createdAsc" data-testid="sort-created-asc">
                  Created (Oldest)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {viewType === "list" ? (
            <>
              <TabsContent value="active" className="mt-4 space-y-3">
                {sortedTasks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No active tasks
                  </div>
                ) : (
                  <>
                    {sortedTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        workspaceSlug={workspaceSlug}
                        isArchived={false}
                        onUndoArchive={refetch}
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
                {sortedTasks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No archived tasks
                  </div>
                ) : (
                  <>
                    {sortedTasks.map((task) => (
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
            </>
          ) : (
            <div className="mt-4">
              <KanbanView
                items={sortedTasks}
                columns={TASK_KANBAN_COLUMNS}
                getItemStatus={(task) => task.status as TaskStatus}
                getItemId={(task) => task.id}
                renderCard={(task) => (
                  <TaskCard
                    task={task}
                    workspaceSlug={workspaceSlug}
                    isArchived={activeTab === "archived"}
                    onUndoArchive={refetch}
                  />
                )}
                sortItems={(a, b) => {
                  // Priority sorting for action artifacts, then respect user's sort preference
                  if (a.hasActionArtifact && !b.hasActionArtifact) return -1;
                  if (!a.hasActionArtifact && b.hasActionArtifact) return 1;
                  // Already sorted by sortTasks function
                  return 0;
                }}
                loading={loading}
              />
              {pagination?.hasMore && (
                <div className="pt-3 border-t flex justify-center mt-4">
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
            </div>
          )}
        </CardContent>
      </Tabs>
    </Card>
  );
}
