"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useDebounce } from "@/hooks/useDebounce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, List, LayoutGrid, Trash2, X, Search, Eye, EyeOff, Bell, Pencil } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FeatureWithDetails, FeatureListResponse, FeatureStatus, FeaturePriority } from "@/types/roadmap";
import { FEATURE_KANBAN_COLUMNS } from "@/types/roadmap";
import { StatusPopover } from "@/components/ui/status-popover";
import { FeaturePriorityPopover } from "@/components/ui/feature-priority-popover";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { FeatureCard } from "./FeatureCard";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { KanbanView } from "@/components/ui/kanban-view";
import { DeploymentStatusBadge } from "@/components/tasks/DeploymentStatusBadge";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import { SortableColumnHeader, FilterDropdownHeader } from "./TableColumnHeaders";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FEATURE_STATUS_LABELS } from "@/types/roadmap";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { usePusherConnection, type DeploymentStatusChangeEvent } from "@/hooks/usePusherConnection";

// Priority configuration for filtering
const FEATURE_PRIORITY_LABELS: Record<FeaturePriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

interface FeaturesListProps {
  workspaceId: string;
}

function FeatureRow({
  feature,
  workspaceSlug,
  onStatusUpdate,
  onPriorityUpdate,
  onAssigneeUpdate,
  onDelete,
  onClick,
  isRenaming,
  onRenameStart,
  onRenameSave,
}: {
  feature: FeatureWithDetails;
  workspaceSlug: string;
  onStatusUpdate: (featureId: string, status: FeatureStatus) => Promise<void>;
  onPriorityUpdate: (featureId: string, priority: FeaturePriority) => Promise<void>;
  onAssigneeUpdate: (featureId: string, assigneeId: string | null) => Promise<void>;
  onDelete: (featureId: string) => Promise<void>;
  onClick: () => void;
  isRenaming: boolean;
  onRenameStart: () => void;
  onRenameSave: (featureId: string, newTitle: string) => Promise<void>;
}) {
  const needsReview = feature._count.stakworkRuns > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState(feature.title);

  // Auto-focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  // Reset edit value when feature title changes or rename mode exits
  useEffect(() => {
    if (!isRenaming) {
      setEditValue(feature.title);
    }
  }, [feature.title, isRenaming]);

  const handleSave = async () => {
    const trimmed = editValue.trim();
    // Only save if non-empty and changed
    if (trimmed && trimmed !== feature.title) {
      await onRenameSave(feature.id, trimmed);
    } else {
      // Revert if empty or unchanged
      setEditValue(feature.title);
      onRenameStart(); // This will toggle off rename mode since it's already true
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditValue(feature.title);
      onRenameStart(); // Toggle off rename mode
    }
  };

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <TableCell className="w-[469px] font-medium truncate">
        <div className="flex items-center gap-2">
          {isRenaming ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          ) : (
            <span className="truncate">{feature.title}</span>
          )}
          {!isRenaming && needsReview && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-shrink-0">
                  <Bell className="h-4 w-4 text-amber-500" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Awaiting your feedback</p>
              </TooltipContent>
            </Tooltip>
          )}
          {!isRenaming && feature.deploymentStatus && (
            <DeploymentStatusBadge
              environment={feature.deploymentStatus}
              deploymentUrl={feature.deploymentUrl}
            />
          )}
        </div>
      </TableCell>
      <TableCell className="w-[120px]" onClick={(e) => e.stopPropagation()}>
        <StatusPopover
          statusType="feature"
          currentStatus={feature.status}
          onUpdate={(status) => onStatusUpdate(feature.id, status)}
        />
      </TableCell>
      <TableCell className="w-[100px]" onClick={(e) => e.stopPropagation()}>
        <FeaturePriorityPopover
          currentPriority={feature.priority}
          onUpdate={(priority) => onPriorityUpdate(feature.id, priority)}
          showLowPriority={true}
        />
      </TableCell>
      <TableCell className="w-[120px] text-muted-foreground text-sm">
        {feature.createdBy?.name || "Unknown"}
      </TableCell>
      <TableCell className="w-[150px]" onClick={(e) => e.stopPropagation()}>
        <AssigneeCombobox
          workspaceSlug={workspaceSlug}
          currentAssignee={feature.assignee}
          onSelect={(assigneeId) => onAssigneeUpdate(feature.id, assigneeId)}
        />
      </TableCell>
      <TableCell className="w-[150px] text-right text-muted-foreground text-sm">
        {formatRelativeOrDate(feature.updatedAt)}
      </TableCell>
      <TableCell className="w-[150px] text-right text-muted-foreground text-sm">
        {new Date(feature.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="w-[50px]" onClick={(e) => e.stopPropagation()}>
        <ActionMenu
          actions={[
            {
              label: "Rename",
              icon: Pencil,
              onClick: onRenameStart,
              separator: true,
            },
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
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { slug: workspaceSlug } = useWorkspace();

  // Fetch workspace members (no system assignees for features)
  const { members } = useWorkspaceMembers(workspaceSlug, { includeSystemAssignees: false });

  const [features, setFeatures] = useState<FeatureWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [workspaceHasFeatures, setWorkspaceHasFeatures] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => parseInt(searchParams?.get("page") ?? "1", 10) || 1);
  const [_hasMore, setHasMore] = useState(false);
  const [totalPages, setTotalPages] = useState(1);

  // Read needsAttention from URL on mount
  useEffect(() => {
    const needsAttentionParam = searchParams?.get("needsAttention");
    if (needsAttentionParam === "true") {
      setNeedsAttentionFilter(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

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

  const [createdByFilter, setCreatedByFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.createdByFilter || "ALL";
        } catch {
          return "ALL";
        }
      }
    }
    return "ALL";
  });

  const [priorityFilters, setPriorityFilters] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.priorityFilters || [];
        } catch {
          return [];
        }
      }
    }
    return [];
  });

  const [sortBy, setSortBy] = useState<"title" | "createdAt" | "updatedAt" | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.sortBy || "updatedAt";
        } catch {
          return "updatedAt";
        }
      }
    }
    return "updatedAt";
  });

  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-filters-sort-preference");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.sortOrder || "desc";
        } catch {
          return "desc";
        }
      }
    }
    return "desc";
  });

  const [searchQuery, setSearchQuery] = useState<string>("");

  // State for showing/hiding canceled features with localStorage persistence
  const [showCanceled, setShowCanceled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-show-canceled-preference");
      return saved === "true"; // Default to false (hide canceled)
    }
    return false;
  });

  // State for filtering features that need attention (pending StakworkRuns)
  const [needsAttentionFilter, setNeedsAttentionFilter] = useState<boolean>(false);

  // Debounce search query to reduce API calls
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // View state management with localStorage persistence
  const [viewType, setViewType] = useState<"list" | "kanban">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("features-view-preference");
      return (saved === "kanban" ? "kanban" : "list") as "list" | "kanban";
    }
    return "list";
  });

  // Rename state management
  const [renamingFeatureId, setRenamingFeatureId] = useState<string | null>(null);

  // Navigate to a specific page and update URL
  const goToPage = useCallback((n: number) => {
    setPage(n);
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (n <= 1) {
      params.delete("page");
    } else {
      params.set("page", n.toString());
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

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
      if (priorityFilters.length > 0) {
        params.append("priority", priorityFilters.join(','));
      }
      if (assigneeFilter !== "ALL") {
        params.append("assigneeId", assigneeFilter);
      }
      if (createdByFilter !== "ALL") {
        params.append("createdById", createdByFilter);
      }

      // Add sort params if set
      if (sortBy) {
        params.append("sortBy", sortBy);
        params.append("sortOrder", sortOrder);
      }

      // Add search param if set (using debounced value)
      if (debouncedSearchQuery.trim()) {
        params.append("search", debouncedSearchQuery.trim());
      }

      // Add needs attention filter if active
      if (needsAttentionFilter) {
        params.append("needsAttention", "true");
      }

      const response = await fetch(`/api/features?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch features");
      }

      const data: FeatureListResponse = await response.json();

      if (data.success) {
        setFeatures(data.data);
        setHasLoadedOnce(true);
        setWorkspaceHasFeatures((data.pagination.totalCountWithoutFilters || 0) > 0);
        setHasMore(data.pagination.hasMore);
        setTotalPages(data.pagination.totalPages);
      } else {
        throw new Error("Failed to fetch features");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Check if any filters are active (excluding default sort)
  const hasActiveFilters = statusFilters.length > 0 || priorityFilters.length > 0 || assigneeFilter !== "ALL" || createdByFilter !== "ALL" || (sortBy !== null && sortBy !== "updatedAt") || debouncedSearchQuery.trim() !== "" || needsAttentionFilter;

  // Calculate visible page numbers (show 3 pages on each side of current page)
  const getPageRange = (current: number, total: number): number[] => {
    const range: number[] = [];
    const delta = 3; // Show 3 pages on each side

    // Calculate the start and end of the range
    let start = Math.max(2, current - delta);
    let end = Math.min(total - 1, current + delta);

    // Adjust if we're near the start
    if (current <= delta + 1) {
      end = Math.min(total - 1, delta * 2 + 1);
    }

    // Adjust if we're near the end
    if (current >= total - delta) {
      start = Math.max(2, total - delta * 2);
    }

    // Build the range
    for (let i = start; i <= end; i++) {
      range.push(i);
    }

    return range;
  };

  useEffect(() => {
    fetchFeatures(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, viewType, page, statusFilters, priorityFilters, assigneeFilter, createdByFilter, sortBy, sortOrder, debouncedSearchQuery, needsAttentionFilter]);

  // Pusher integration for real-time deployment updates
  const handleDeploymentStatusChange = useCallback((event: DeploymentStatusChangeEvent) => {
    // Refetch features to get updated deployment status
    // Since we don't have task-to-feature mapping in the list view,
    // we refetch all features when any deployment changes
    fetchFeatures(page);
  }, [page]);

  usePusherConnection({
    workspaceSlug,
    enabled: true,
    onDeploymentStatusChange: handleDeploymentStatusChange,
  });

  // Save filter and sort preferences to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const preferences = {
        statusFilters,
        priorityFilters,
        assigneeFilter,
        createdByFilter,
        sortBy,
        sortOrder,
      };
      localStorage.setItem("features-filters-sort-preference", JSON.stringify(preferences));
    }
  }, [statusFilters, priorityFilters, assigneeFilter, createdByFilter, sortBy, sortOrder]);

  // Save show canceled preference to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("features-show-canceled-preference", showCanceled.toString());
    }
  }, [showCanceled]);

  // Toggle show/hide canceled features
  const handleToggleCanceled = async () => {
    const newValue = !showCanceled;
    setShowCanceled(newValue);
  };

  // Save view preference to localStorage
  const handleViewChange = (value: string) => {
    if (value === "list" || value === "kanban") {
      setViewType(value);
      goToPage(1); // Reset to first page when switching views
      localStorage.setItem("features-view-preference", value);
    }
  };

  // Handle filter changes - reset to page 1
  const handleStatusFiltersChange = (statuses: string | string[]) => {
    const statusArray = Array.isArray(statuses) ? statuses : [statuses];
    setStatusFilters(statusArray);
    goToPage(1);
  };

  const handleAssigneeFilterChange = (value: string | string[]) => {
    // Assignee filter is single-select, so always get first value if array
    const assigneeId = Array.isArray(value) ? value[0] : value;
    setAssigneeFilter(assigneeId);
    goToPage(1);
  };

  const handleCreatedByFilterChange = (value: string | string[]) => {
    // Created by filter is single-select, so always get first value if array
    const createdById = Array.isArray(value) ? value[0] : value;
    setCreatedByFilter(createdById);
    goToPage(1);
  };

  const handlePriorityFiltersChange = (priorities: string | string[]) => {
    const priorityArray = Array.isArray(priorities) ? priorities : [priorities];
    setPriorityFilters(priorityArray);
    goToPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    goToPage(1);
  };

  // Handle sort changes - reset to page 1 when changing sort field
  const handleSort = (field: "title" | "createdAt" | "updatedAt", order: "asc" | "desc" | null) => {
    if (order === null) {
      setSortBy(null);
    } else {
      setSortBy(field);
      setSortOrder(order);
      if (sortBy !== field) {
        goToPage(1);
      }
    }
  };

  // Clear all filters and sort
  const handleClearFilters = () => {
    setStatusFilters([]);
    setPriorityFilters([]);
    setAssigneeFilter("ALL");
    setCreatedByFilter("ALL");
    setSortBy("updatedAt");
    setSortOrder("desc");
    setSearchQuery("");
    setNeedsAttentionFilter(false);
    goToPage(1);
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

  const handleUpdatePriority = async (featureId: string, priority: FeaturePriority) => {
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });

      if (!response.ok) {
        throw new Error("Failed to update priority");
      }

      setFeatures((prev) => prev.map((f) => (f.id === featureId ? { ...f, priority } : f)));
    } catch (error) {
      console.error("Failed to update priority:", error);
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

  const handleRenameFeature = async (featureId: string, newTitle: string) => {
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        throw new Error("Failed to rename feature");
      }

      // Update local state
      setFeatures((prev) => prev.map((f) => f.id === featureId ? { ...f, title: newTitle } : f));
      setRenamingFeatureId(null);
    } catch (error) {
      console.error("Failed to rename feature:", error);
      // Revert rename state on error
      setRenamingFeatureId(null);
      throw error;
    }
  };

  // Prepare filter options
  const statusOptions = [
    { value: "ALL", label: "All Statuses" },
    ...Object.entries(FEATURE_STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  ];

  const priorityOptions = [
    { value: "ALL", label: "All Priorities" },
    ...Object.entries(FEATURE_PRIORITY_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  ];

  const assigneeOptions = [
    { value: "ALL", label: "All Assignees", image: null, name: null },
    { value: "UNASSIGNED", label: "Unassigned", image: null, name: null },
    ...members.map((member) => ({
      value: member.user.id,
      label: member.user.name || member.user.email || "Unknown",
      image: member.user.image,
      name: member.user.name,
    })),
  ];

  const createdByOptions = [
    { value: "ALL", label: "All Creators", image: null, name: null },
    { value: "UNCREATED", label: "Unset", image: null, name: null },
    ...members.map((member) => ({
      value: member.user.id,
      label: member.user.name || member.user.email || "Unknown",
      image: member.user.image,
      name: member.user.name,
    })),
  ];

  // Filter features to hide cancelled if showCanceled is false - using useMemo for reactivity
  const filteredFeatures = useMemo(() => {
    return showCanceled 
      ? features 
      : features.filter(feature => feature.status !== "CANCELLED");
  }, [features, showCanceled]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
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
        {loading && !hasLoadedOnce ? (
          <div className="rounded-md border">
            <Table className="table-fixed">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[469px]">Title</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[100px]">Priority</TableHead>
                  <TableHead className="w-[120px]">Created by</TableHead>
                  <TableHead className="w-[150px]">Assigned</TableHead>
                  <TableHead className="w-[150px] text-right">Updated At</TableHead>
                  <TableHead className="w-[150px] text-right">Created</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i}>
                    <TableCell className="w-[469px]">
                      <Skeleton className="h-5 w-full max-w-xs" />
                    </TableCell>
                    <TableCell className="w-[120px]">
                      <Skeleton className="h-6 w-20" />
                    </TableCell>
                    <TableCell className="w-[100px]">
                      <Skeleton className="h-6 w-20" />
                    </TableCell>
                    <TableCell className="w-[120px]">
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell className="w-[150px]">
                      <Skeleton className="h-6 w-32" />
                    </TableCell>
                    <TableCell className="w-[150px] text-right">
                      <Skeleton className="h-4 w-24 ml-auto" />
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
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-red-600 font-medium">Error loading features</p>
            <p className="text-muted-foreground mt-2">{error}</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search features..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 pr-9 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => handleSearchChange("")}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button
                  variant={needsAttentionFilter ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setNeedsAttentionFilter(!needsAttentionFilter);
                    goToPage(1);
                  }}
                  className="whitespace-nowrap"
                >
                  <Bell className="h-4 w-4 mr-2" />
                  Needs input
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleCanceled}
                  className="whitespace-nowrap"
                >
                  {showCanceled ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Hide canceled
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Show canceled
                    </>
                  )}
                </Button>
              </div>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={handleClearFilters}>
                  <X className="h-4 w-4 mr-2" />
                  Clear filters
                </Button>
              )}
            </div>

            {viewType === "list" ? (
              hasLoadedOnce && (workspaceHasFeatures || hasActiveFilters) ? (
                <div className="rounded-md border">
                  <Table className="table-fixed">
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-[469px]">
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
                        <TableHead className="w-[100px]">
                          <FilterDropdownHeader
                            label="Priority"
                            options={priorityOptions}
                            value={priorityFilters}
                            onChange={handlePriorityFiltersChange}
                            showSearch={false}
                            multiSelect={true}
                            showPriorityBadges={true}
                          />
                        </TableHead>
                        <TableHead className="w-[120px]">
                          <FilterDropdownHeader
                            label="Created by"
                            options={createdByOptions}
                            value={createdByFilter}
                            onChange={handleCreatedByFilterChange}
                            showSearch={true}
                            showAvatars={true}
                          />
                        </TableHead>
                        <TableHead className="w-[150px]">
                          <FilterDropdownHeader
                            label="Assigned"
                            options={assigneeOptions}
                            value={assigneeFilter}
                            onChange={handleAssigneeFilterChange}
                            showSearch={true}
                            showAvatars={true}
                          />
                        </TableHead>
                        <TableHead className="w-[150px] text-right">
                          <SortableColumnHeader
                            label="Updated At"
                            field="updatedAt"
                            currentSort={sortBy === "updatedAt" ? sortOrder : null}
                            onSort={(order) => handleSort("updatedAt", order)}
                            align="right"
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
                      {filteredFeatures.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="h-32 text-center">
                            <p className="text-muted-foreground">No features match your filters</p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredFeatures.map((feature) => (
                          <FeatureRow
                            key={feature.id}
                            feature={feature}
                            workspaceSlug={workspaceSlug}
                            onStatusUpdate={handleUpdateStatus}
                            onPriorityUpdate={handleUpdatePriority}
                            onAssigneeUpdate={handleUpdateAssignee}
                            onDelete={handleDeleteFeature}
                            onClick={() => router.push(`/w/${workspaceSlug}/plan/${feature.id}`)}
                            isRenaming={renamingFeatureId === feature.id}
                            onRenameStart={() => setRenamingFeatureId(feature.id)}
                            onRenameSave={handleRenameFeature}
                          />
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : null
            ) : (
              <KanbanView
                items={filteredFeatures}
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

            {viewType === "list" && filteredFeatures.length > 0 && (
              <div className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                </div>
                <Pagination>
                  <PaginationContent>
                    {/* Previous button */}
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          goToPage(Math.max(1, page - 1));
                        }}
                        aria-disabled={page === 1}
                        className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>

                    {/* Always show page 1 */}
                    {totalPages > 0 && (
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            goToPage(1);
                          }}
                          isActive={page === 1}
                          className={page === 1 ? "pointer-events-none" : "cursor-pointer"}
                        >
                          1
                        </PaginationLink>
                      </PaginationItem>
                    )}

                    {/* Show ellipsis if there's a gap between page 1 and the range */}
                    {page > 4 && totalPages > 7 && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}

                    {/* Show page range (3 pages on each side of current) */}
                    {getPageRange(page, totalPages).map((pageNum) => (
                      <PaginationItem key={pageNum}>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            goToPage(pageNum);
                          }}
                          isActive={page === pageNum}
                          className={page === pageNum ? "pointer-events-none" : "cursor-pointer"}
                        >
                          {pageNum}
                        </PaginationLink>
                      </PaginationItem>
                    ))}

                    {/* Show ellipsis if there's a gap between the range and last page */}
                    {page < totalPages - 3 && totalPages > 7 && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}

                    {/* Always show last page (if > 1) */}
                    {totalPages > 1 && (
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            goToPage(totalPages);
                          }}
                          isActive={page === totalPages}
                          className={page === totalPages ? "pointer-events-none" : "cursor-pointer"}
                        >
                          {totalPages}
                        </PaginationLink>
                      </PaginationItem>
                    )}

                    {/* Next button */}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          goToPage(Math.min(totalPages, page + 1));
                        }}
                        aria-disabled={page >= totalPages}
                        className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
