"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Plus, List, LayoutGrid, Trash2 } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FeatureWithDetails, FeatureListResponse, FeatureStatus } from "@/types/roadmap";
import { FEATURE_KANBAN_COLUMNS } from "@/types/roadmap";
import { StatusPopover } from "@/components/ui/status-popover";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { FeatureCard } from "./FeatureCard";
import { useWorkspace } from "@/hooks/useWorkspace";
import { KanbanView } from "@/components/ui/kanban-view";

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
      <TableCell className="w-[600px] max-w-0 font-medium truncate">{feature.title}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
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
      <TableCell className="text-right text-muted-foreground text-sm">
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
  const [features, setFeatures] = useState<FeatureWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

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

  const fetchFeatures = async (pageNum: number, append = false) => {
    try {
      setLoading(true);
      // Fetch more items for kanban view, fewer for list view
      const limit = viewType === "kanban" ? 100 : 10;
      const response = await fetch(`/api/features?workspaceId=${workspaceId}&page=${pageNum}&limit=${limit}`);

      if (!response.ok) {
        throw new Error("Failed to fetch features");
      }

      const data: FeatureListResponse = await response.json();

      if (data.success) {
        if (append) {
          setFeatures((prev) => [...prev, ...data.data]);
        } else {
          setFeatures(data.data);
        }
        setHasMore(data.pagination.hasMore);
        setTotalCount(data.pagination.totalCount);
      } else {
        throw new Error("Failed to fetch features");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeatures(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, viewType]);

  // Auto-open creation form when no features exist
  useEffect(() => {
    if (!loading && features.length === 0 && !isCreating) {
      setIsCreating(true);
      setViewType("list");
      localStorage.setItem("features-view-preference", "list");
    }
  }, [loading, features.length, isCreating]);

  // Auto-focus after feature creation completes
  useEffect(() => {
    if (!creating && !newFeatureTitle && isCreating) {
      featureInputRef.current?.focus();
    }
  }, [creating, newFeatureTitle, isCreating]);

  // Save view preference to localStorage
  const handleViewChange = (value: string) => {
    if (value === "list" || value === "kanban") {
      setViewType(value);
      localStorage.setItem("features-view-preference", value);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchFeatures(nextPage, true);
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
      setTotalCount((prev) => prev - 1);
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
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[180px]">Assigned</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-full max-w-xs" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-32" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-4 w-24 ml-auto" />
                    </TableCell>
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

  // Always show table if creating or have features
  const showTable = features.length > 0 || isCreating;

  return showTable ? (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Features
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="font-normal text-muted-foreground">
              {totalCount} feature{totalCount !== 1 ? "s" : ""}
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
      </CardHeader>
      <CardContent>
        {!isCreating && (
          <div className="mb-4">
            <Button variant="default" size="sm" onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New feature
            </Button>
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
                <TableHead className="w-[600px]">Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px]">Assigned</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.map((feature) => (
                <FeatureRow
                  key={feature.id}
                  feature={feature}
                  workspaceSlug={workspaceSlug}
                  onStatusUpdate={handleUpdateStatus}
                  onAssigneeUpdate={handleUpdateAssignee}
                  onDelete={handleDeleteFeature}
                  onClick={() => router.push(`/w/${workspaceSlug}/roadmap/${feature.id}`)}
                />
              ))}
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

        {hasMore && viewType === "list" && (
          <div className="pt-4 flex justify-center">
            <Button variant="outline" onClick={handleLoadMore} disabled={loading} size="sm">
              {loading ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  Loading...
                </>
              ) : (
                "Load More"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  ) : null;
}
