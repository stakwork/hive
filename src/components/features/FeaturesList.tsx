"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Plus, List, LayoutGrid, Trash2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FeatureWithDetails, FeatureListResponse, FeatureStatus } from "@/types/roadmap";
import { FEATURE_KANBAN_COLUMNS } from "@/types/roadmap";
import { StatusPopover } from "@/components/ui/status-popover";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { FeatureCard } from "./FeatureCard";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { KanbanView } from "@/components/ui/kanban-view";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { SortableColumnHeader, FilterDropdownHeader } from "./TableColumnHeaders";
import { FEATURE_STATUS_LABELS } from "@/types/roadmap";

interface FeaturesListProps {
  workspaceId: string;
}

function FeatureRow({
  feature,
  workspaceSlug,
  onStatusUpdate,
  onAssigneeUpdate,
  onDelete,
  onClick,
}: {
  feature: FeatureWithDetails;
  workspaceSlug: string;
  onStatusUpdate: (featureId: string, status: FeatureStatus) => Promise<void>;
  onAssigneeUpdate: (featureId: string, assigneeId: string | null) => Promise<void>;
  onDelete: (featureId: string) => Promise<void>;
  onClick: () => void;
}) {
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <TableCell className="w-[300px] font-medium truncate">{feature.title}</TableCell>
      <TableCell className="w-[120px]" onClick={(e) => e.stopPropagation()}>
        <StatusPopover
          statusType="feature"
          currentStatus={feature.status}
          onUpdate={(status) => onStatusUpdate(feature.id, status)}
        />
      </TableCell>
      <TableCell className="w-[180px]" onClick={(e) => e.stopPropagation()}>
        <AssigneeCombobox
          workspaceSlug={workspaceSlug}
          currentAssignee={feature.assignee}
          onSelect={(assigneeId) => onAssigneeUpdate(feature.id, assigneeId)}
        />
      </TableCell>
      <TableCell className="w-[150px] text-right text-muted-foreground text-sm">
        {new Date(feature.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="w-[50px]" onClick={(e) => e.stopPropagation()}>
        <ActionMenu
          actions={[
            {
              label: "Delete",
              icon: Trash2,
              variant: "destructive",
              confirmation: {
                title: "Delete Feature",
                description: `Are you sure you want to delete "${feature.title}"? This will also delete all associated phases and tickets.`,
                onConfirm: () => onDelete(feature.id),
              },
            },
          ]}
        />
      </TableCell>
    </TableRow>
  );
}

export function FeaturesList({ workspaceId }: FeaturesListProps) {
  const router = useRouter();
  const { slug: workspaceSlug } = useWorkspace();

  // Fetch workspace members (no system assignees for features)
  const { members } = useWorkspaceMembers(workspaceSlug, { includeSystemAssignees: false });

  const [features, setFeatures] = useState<FeatureWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Filter and sort state with localStorage persistence
  const [statusFilters, setStatusFilters] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.statusFilters || [];
        } catch {
          return [];
        }
      }
    }
    return [];
  });

  const [assigneeFilter, setAssigneeFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.assigneeFilter || "ALL";
        } catch {
          return "ALL";
        }
      }
    }
    return "ALL";
  });

  const [sortBy, setSortBy] = useState<"title" | "createdAt" | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.sortBy || null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });

  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.sortOrder || "asc";
        } catch {
          return "asc";
        }
      }
    }
    return "asc";
  });

  // New feature creation state
  const [isCreating, setIsCreating] = useState(false);
  const [newFeatureTitle, setNewFeatureTitle] = useState("");
  const [newFeatureStatus, setNewFeatureStatus] = useState<FeatureStatus>("BACKLOG");
  const [newFeatureAssigneeId, setNewFeatureAssigneeId] = useState<string | null>(null);
  const [newFeatureAssigneeDisplay, setNewFeatureAssigneeDisplay] = useState<{
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const featureInputRef = useRef<HTMLInputElement>(null);

  // View state management with localStorage persistence
  const [viewType, setViewType] = useState<"list" | "kanban">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-view-preference");
      return (saved === "kanban" ? "kanban" : "list") as "list" | "kanban";
    }
    return "list";
  });

  const fetchFeatures = async (pageNum: number) => {
    try {
      setLoading(true);
      // Fetch more items for kanban view, fewer for list view
      const limit = viewType === "kanban" ? 100 : 10;

      // Build query params
      const params = new URLSearchParams({
        workspaceId,
        page: pageNum.toString(),
        limit: limit.toString(),
      });

      // Add filter params
      if (statusFilters.length > 0) {
        params.append("status", statusFilters.join(','));
      }
      if (assigneeFilter !== "ALL") {
        params.append("assigneeId", assigneeFilter);
      }

      // Add sort params if set
      if (sortBy) {
        params.append("sortBy", sortBy);
        params.append("sortOrder", sortOrder);
      }

      const response = await fetch(`/api/features?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch features");
      }

      const data: FeatureListResponse = await response.json();

      if (data.success) {
        setFeatures(data.data);
        setHasMore(data.pagination.hasMore);
      } else {
        throw new Error("Failed to fetch features");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Check if any filters are active
  const hasActiveFilters = statusFilters.length > 0 || assigneeFilter !== "ALL" || sortBy !== null;

  useEffect(() => {
    fetchFeatures(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, viewType, page, statusFilters, assigneeFilter, sortBy, sortOrder]);

  // Auto-open creation form when no features exist AND no filters are active
  useEffect(() => {
    if (!loading && features.length === 0 && !isCreating && !hasActiveFilters) {
      setIsCreating(true);
      setViewType("list");
      localStorage.setItem("features-view-preference", "list");
    }
  }, [loading, features.length, isCreating, hasActiveFilters]);

  // Auto-focus after feature creation completes
  useEffect(() => {
    if (!creating && !newFeatureTitle && isCreating) {
      featureInputRef.current?.focus();
    }
  }, [creating, newFeatureTitle, isCreating]);

  // Save filter and sort preferences to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const preferences = {
        statusFilters,
        assigneeFilter,
        sortBy,
        sortOrder,
      };
      localStorage.setItem("features-filters-sort-preference", JSON.stringify(preferences));
    }
  }, [statusFilters, assigneeFilter, sortBy, sortOrder]);

  // Save view preference to localStorage
  const handleViewChange = (value: string) => {
    if (value === "list" || value === "kanban") {
      setViewType(value);
      setPage(1); // Reset to first page when switching views
      localStorage.setItem("features-view-preference", value);
    }
  };

  // Handle filter changes - reset to page 1
  const handleStatusFiltersChange = (statuses: string | string[]) => {
    const statusArray = Array.isArray(statuses) ? statuses : [statuses];
    setStatusFilters(statusArray);
    setPage(1);
  };

  const handleAssigneeFilterChange = (value: string | string[]) => {
    // Assignee filter is single-select, so always get first value if array
    const assigneeId = Array.isArray(value) ? value[0] : value;
    setAssigneeFilter(assigneeId);
    setPage(1);
  };

  // Handle sort changes - reset to page 1 when changing sort field
  const handleSort = (field: "title" | "createdAt", order: "asc" | "desc" | null) => {
    if (order === null) {
      setSortBy(null);
    } else {
      setSortBy(field);
      setSortOrder(order);
      if (sortBy !== field) {
        setPage(1);
      }
    }
  };

  // Clear all filters and sort
  const handleClearFilters = () => {
    setStatusFilters([]);
    setAssigneeFilter("ALL");
    setSortBy(null);
    setSortOrder("asc");
    setPage(1);
  };

  const handleUpdateStatus = async (featureId: string, status: FeatureStatus) => {
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error("Failed to update status");
      }

      setFeatures((prev) => prev.map((f) => (f.id === featureId ? { ...f, status } : f)));
    } catch (error) {
      console.error("Failed to update status:", error);
      throw error;
    }
  };

  const handleUpdateAssignee = async (featureId: string, assigneeId: string | null) => {
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId }),
      });

      if (!response.ok) {
        throw new Error("Failed to update assignee");
      }

      // Refetch to get updated assignee data
      await fetchFeatures(1);
    } catch (error) {
      console.error("Failed to update assignee:", error);
      throw error;
    }
  };

  const handleFeatureStatusChange = async (featureId: string, newStatus: FeatureStatus) => {
    try {
      // Optimistic update
      setFeatures((prev) => prev.map((f) => (f.id === featureId ? { ...f, status: newStatus } : f)));

      const response = await fetch(`/api/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error("Failed to update feature status");
      }
    } catch (error) {
      console.error("Failed to update feature status:", error);
      // Revert on error
      await fetchFeatures(1);
    }
  };

  const handleCreateFeature = async () => {
    if (!newFeatureTitle.trim()) {
      return;
    }

    try {
      setCreating(true);
      const response = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newFeatureTitle.trim(),
          workspaceId,
          status: newFeatureStatus,
          assigneeId: newFeatureAssigneeId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create feature");
      }

      const result = await response.json();

      if (result.success) {
        // Navigate to the new feature detail page
        router.push(`/w/${workspaceSlug}/roadmap/${result.data.id}`);
      }
    } catch (error) {
      console.error("Failed to create feature:", error);
      // TODO: Show error toast
    } finally {
      setCreating(false);
    }
  };

  const handleCancelCreate = () => {
    setNewFeatureTitle("");
    setNewFeatureStatus("BACKLOG");
    setNewFeatureAssigneeId(null);
    setNewFeatureAssigneeDisplay(null);
    setIsCreating(false);
  };

  const handleDeleteFeature = async (featureId: string) => {
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete feature");
      }

      // Remove from local state
      setFeatures((prev) => prev.filter((f) => f.id !== featureId));
    } catch (error) {
      console.error("Failed to delete feature:", error);
    }
  };

  if (loading && features.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 justify-between">
            <span>Features</span>
            <span className="font-normal text-sm text-muted-foreground">Loading...</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Button variant="default" size="sm" disabled>
              <Plus className="h-4 w-4 mr-2" />
              New feature
            </Button>
          </div>

          <div className="rounded-md border">
            <Table className="table-fixed">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[300px]">Title</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[180px]">Assigned</TableHead>
                  <TableHead className="w-[150px] text-right">Created</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i}>
                    <TableCell className="w-[300px]">
                      <Skeleton className="h-5 w-full max-w-xs" />
                    </TableCell>
                    <TableCell className="w-[120px]">
                      <Skeleton className="h-6 w-20" />
                    </TableCell>
                    <TableCell className="w-[180px]">
                      <Skeleton className="h-6 w-32" />
                    </TableCell>
                    <TableCell className="w-[150px] text-right">
                      <Skeleton className="h-4 w-24 ml-auto" />
                    </TableCell>
                    <TableCell className="w-[50px]"></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">Error loading features</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Prepare filter options
  const statusOptions = [
    { value: "ALL", label: "All Statuses" },
    ...Object.entries(FEATURE_STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  ];

  const assigneeOptions = [
    { value: "ALL", label: "All Assignees" },
    { value: "UNASSIGNED", label: "Unassigned" },
    ...members.map((member) => ({
      value: member.user.id,
      label: member.user.name || member.user.email || "Unknown",
    })),
  ];

  // Always show table if creating, have features, or filters are active
  const showTable = features.length > 0 || isCreating || hasActiveFilters;

  return showTable ? (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Features
          </div>
          <ToggleGroup
            type="single"
            value={viewType}
            onValueChange={handleViewChange}
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
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!isCreating && (
          <div className="mb-4 flex items-center justify-between">
            <Button variant="default" size="sm" onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New feature
            </Button>
            {hasActiveFilters && viewType === "list" && (
              <Button variant="outline" size="sm" onClick={handleClearFilters}>
                <X className="h-4 w-4 mr-2" />
                Clear filters
              </Button>
            )}
          </div>
        )}

        {isCreating && (
          <div className="mb-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="space-y-3">
                <div>
                  <Input
                    ref={featureInputRef}
                    placeholder="Feature title..."
                    value={newFeatureTitle}
                    onChange={(e) => setNewFeatureTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !creating) {
                        handleCreateFeature();
                      } else if (e.key === "Escape") {
                        handleCancelCreate();
                      }
                    }}
                    autoFocus
                    disabled={creating}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <StatusPopover
                    statusType="feature"
                    currentStatus={newFeatureStatus}
                    onUpdate={async (status) => setNewFeatureStatus(status)}
                  />
                  <AssigneeCombobox
                    workspaceSlug={workspaceSlug}
                    currentAssignee={newFeatureAssigneeDisplay}
                    onSelect={async (assigneeId, assigneeData) => {
                      setNewFeatureAssigneeId(assigneeId);
                      setNewFeatureAssigneeDisplay(assigneeData || null);
                    }}
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={handleCancelCreate} disabled={creating}>
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleCreateFeature}
                    disabled={creating || !newFeatureTitle.trim()}
                  >
                    {creating ? (
                      <>
                        <Spinner className="h-4 w-4 mr-2" />
                        Creating...
                      </>
                    ) : (
                      "Create"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewType === "list" ? (
          <div className="rounded-md border">
          <Table className="table-fixed">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[300px]">
                  <SortableColumnHeader
                    label="Title"
                    field="title"
                    currentSort={sortBy === "title" ? sortOrder : null}
                    onSort={(order) => handleSort("title", order)}
                  />
                </TableHead>
                <TableHead className="w-[120px]">
                  <FilterDropdownHeader
                    label="Status"
                    options={statusOptions}
                    value={statusFilters}
                    onChange={handleStatusFiltersChange}
                    showSearch={false}
                    multiSelect={true}
                    showStatusBadges={true}
                  />
                </TableHead>
                <TableHead className="w-[180px]">
                  <FilterDropdownHeader
                    label="Assigned"
                    options={assigneeOptions}
                    value={assigneeFilter}
                    onChange={handleAssigneeFilterChange}
                    showSearch={true}
                  />
                </TableHead>
                <TableHead className="w-[150px] text-right">
                  <SortableColumnHeader
                    label="Created"
                    field="createdAt"
                    currentSort={sortBy === "createdAt" ? sortOrder : null}
                    onSort={(order) => handleSort("createdAt", order)}
                    align="right"
                  />
                </TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <p className="text-muted-foreground">No features match your filters</p>
                  </TableCell>
                </TableRow>
              ) : (
                features.map((feature) => (
                  <FeatureRow
                    key={feature.id}
                    feature={feature}
                    workspaceSlug={workspaceSlug}
                    onStatusUpdate={handleUpdateStatus}
                    onAssigneeUpdate={handleUpdateAssignee}
                    onDelete={handleDeleteFeature}
                    onClick={() => router.push(`/w/${workspaceSlug}/roadmap/${feature.id}`)}
                  />
                ))
              )}
            </TableBody>
          </Table>
          </div>
        ) : (
          <KanbanView
            items={features}
            columns={FEATURE_KANBAN_COLUMNS}
            getItemStatus={(feature) => feature.status}
            getItemId={(feature) => feature.id}
            renderCard={(feature) => (
              <FeatureCard
                feature={feature}
                workspaceSlug={workspaceSlug}
                hideStatus={true}
              />
            )}
            sortItems={(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()}
            loading={loading}
            enableDragDrop={true}
            onStatusChange={handleFeatureStatusChange}
          />
        )}

        {viewType === "list" && features.length > 0 && (
          <div className="pt-4">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <Button
                    variant="ghost"
                    size="default"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="gap-1 pl-2.5"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span>Previous</span>
                  </Button>
                </PaginationItem>

                {page > 1 && (
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPage(1)}
                    >
                      1
                    </Button>
                  </PaginationItem>
                )}

                {page > 2 && (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                )}

                <PaginationItem>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled
                  >
                    {page}
                  </Button>
                </PaginationItem>

                {hasMore && (
                  <>
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="default"
                        onClick={() => setPage((p) => p + 1)}
                        className="gap-1 pr-2.5"
                      >
                        <span>Next</span>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </PaginationItem>
                  </>
                )}
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </CardContent>
    </Card>
  ) : null;
}
