"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { FileText, Plus, List, LayoutGrid } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FeatureWithDetails, FeatureListResponse, FeatureStatus } from "@/types/roadmap";
import { FEATURE_STATUS_COLORS, FEATURE_KANBAN_COLUMNS } from "@/types/roadmap";
import { StatusPopover } from "./StatusPopover";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { FeatureCard } from "./FeatureCard";
import { useWorkspace } from "@/hooks/useWorkspace";
import { KanbanView } from "@/components/ui/kanban-view";

interface FeaturesListProps {
  workspaceId: string;
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
        // Prepend new feature to the list
        setFeatures((prev) => [result.data, ...prev]);
        setTotalCount((prev) => prev + 1);

        // Reset state
        setNewFeatureTitle("");
        setNewFeatureStatus("BACKLOG");
        setNewFeatureAssigneeId(null);
        setNewFeatureAssigneeDisplay(null);
        setIsCreating(false);
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

  if (loading && features.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 justify-between">
            <span>Features</span>
            <span className="font-normal text-sm text-muted-foreground">Loading...</span>
          </CardTitle>
          <CardDescription>Your product roadmap features and their current status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Button variant="default" size="sm" disabled>
              <Plus className="h-4 w-4 mr-2" />
              New feature
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[40%]">Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
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

  // Show empty state only if no features and not creating
  if (features.length === 0 && !isCreating) {
    return (
      <Card>
        <CardContent className="p-0">
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No Features Yet</EmptyTitle>
              <EmptyDescription>Create your first feature to get started with your product roadmap.</EmptyDescription>
              <Button variant="default" size="sm" onClick={() => setIsCreating(true)} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                New feature
              </Button>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  // If creating with no features, show table with just the creation row
  const showTable = features.length > 0 || isCreating;

  return showTable ? (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {viewType === "list" ? "Recent Features" : "Features"}
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
        <CardDescription>Your product roadmap features and their current status</CardDescription>
      </CardHeader>
      <CardContent className={viewType === "kanban" ? "p-0" : ""}>
        {!isCreating && viewType === "list" && (
          <div className="mb-4">
            <Button variant="default" size="sm" onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New feature
            </Button>
          </div>
        )}

        {isCreating && viewType === "list" && (
          <div className="mb-4 rounded-lg border bg-muted/30 p-4">
            <div className="space-y-3">
              <div>
                <Input
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
                  currentStatus={newFeatureStatus}
                  onUpdate={async (status) => setNewFeatureStatus(status)}
                  statusColors={FEATURE_STATUS_COLORS}
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
        )}

        {viewType === "list" ? (
          <div className="rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[40%]">Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.map((feature) => (
                <TableRow
                  key={feature.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => router.push(`/w/${workspaceSlug}/roadmap/${feature.id}`)}
                >
                  <TableCell className="font-medium">{feature.title}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <StatusPopover
                      currentStatus={feature.status}
                      onUpdate={(status) => handleUpdateStatus(feature.id, status)}
                      statusColors={FEATURE_STATUS_COLORS}
                    />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <AssigneeCombobox
                      workspaceSlug={workspaceSlug}
                      currentAssignee={feature.assignee}
                      onSelect={(assigneeId) => handleUpdateAssignee(feature.id, assigneeId)}
                    />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {new Date(feature.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
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
