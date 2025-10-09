"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { FileText, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { FeatureWithDetails, FeatureListResponse, FeatureStatus } from "@/types/roadmap";
import { StatusPopover } from "./StatusPopover";
import { AssigneeCombobox } from "./AssigneeCombobox";
import { useWorkspace } from "@/hooks/useWorkspace";

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

  const fetchFeatures = async (pageNum: number, append = false) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/features?workspaceId=${workspaceId}&page=${pageNum}&limit=10`);

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
  }, [workspaceId]);

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

  const statusColors: Record<string, string> = {
    BACKLOG: "bg-gray-100 text-gray-700 border-gray-200",
    PLANNED: "bg-purple-50 text-purple-700 border-purple-200",
    IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
    COMPLETED: "bg-green-50 text-green-700 border-green-200",
    CANCELLED: "bg-red-50 text-red-700 border-red-200",
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
          <span>Features</span>
          <span className="font-normal text-sm text-muted-foreground">
            {totalCount} feature{totalCount !== 1 ? "s" : ""}
          </span>
        </CardTitle>
        <CardDescription>Your product roadmap features and their current status</CardDescription>
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
                  statusColors={statusColors}
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
                      statusColors={statusColors}
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

        {hasMore && (
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
