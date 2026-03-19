"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Loader2, PenLine, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FilterDropdownHeader } from "@/components/features/TableColumnHeaders";

const STORAGE_KEY = "whiteboards-filters-preference";

interface WhiteboardItem {
  id: string;
  name: string;
  featureId: string | null;
  feature: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string | null; image: string | null } | null;
}

interface CreatorOption {
  value: string;
  label: string;
  image: string | null;
}

export default function WhiteboardsPage() {
  const router = useRouter();
  const { id: workspaceId, slug } = useWorkspace();
  const [whiteboards, setWhiteboards] = useState<WhiteboardItem[]>([]);
  const [creatorOptions, setCreatorOptions] = useState<CreatorOption[]>([
    { value: "ALL", label: "All Creators", image: null },
  ]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [creatorFilter, setCreatorFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.creatorFilter || "ALL";
        } catch {
          return "ALL";
        }
      }
    }
    return "ALL";
  });

  // Persist filter to localStorage
  const handleCreatorFilterChange = useCallback((value: string | string[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    setCreatorFilter(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ creatorFilter: next }));
    }
  }, []);

  // Initial load: fetch all (unfiltered) to build creator options list
  const loadCreatorOptions = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/whiteboards?workspaceId=${workspaceId}`);
      const data = await res.json();
      if (data.success) {
        const seen = new Set<string>();
        const options: CreatorOption[] = [{ value: "ALL", label: "All Creators", image: null }];
        for (const wb of data.data as WhiteboardItem[]) {
          if (wb.createdBy && !seen.has(wb.createdBy.id)) {
            seen.add(wb.createdBy.id);
            options.push({
              value: wb.createdBy.id,
              label: wb.createdBy.name ?? "Unknown",
              image: wb.createdBy.image,
            });
          }
        }
        setCreatorOptions(options);
      }
    } catch (error) {
      console.error("Error loading creator options:", error);
    }
  }, [workspaceId]);

  const loadWhiteboards = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const params = new URLSearchParams({ workspaceId });
      if (creatorFilter !== "ALL") {
        params.set("createdById", creatorFilter);
      }
      const res = await fetch(`/api/whiteboards?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setWhiteboards(data.data);
      }
    } catch (error) {
      console.error("Error loading whiteboards:", error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, creatorFilter]);

  // Load creator options once on mount
  useEffect(() => {
    loadCreatorOptions();
  }, [loadCreatorOptions]);

  // Reload list whenever filter changes
  useEffect(() => {
    loadWhiteboards();
  }, [loadWhiteboards]);

  const handleCreate = async () => {
    if (!workspaceId) return;

    setCreating(true);
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: `Whiteboard ${whiteboards.length + 1}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        router.push(`/w/${slug}/whiteboards/${data.data.id}`);
      }
    } catch (error) {
      console.error("Error creating whiteboard:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/whiteboards/${deleteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setWhiteboards((prev) => prev.filter((wb) => wb.id !== deleteId));
      }
    } catch (error) {
      console.error("Error deleting whiteboard:", error);
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Whiteboards" />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Whiteboards"
        actions={
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            New Whiteboard
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <FilterDropdownHeader
          label="Creator"
          options={creatorOptions}
          value={creatorFilter}
          onChange={handleCreatorFilterChange}
          showSearch={true}
          showAvatars={true}
        />
      </div>

      {whiteboards.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="text-center py-12">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <PenLine className="w-6 h-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-lg">No whiteboards yet</CardTitle>
            <CardDescription>
              {creatorFilter !== "ALL"
                ? "No whiteboards found for the selected creator"
                : "Create your first whiteboard to start collaborating"}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {whiteboards.map((wb) => (
            <Link
              key={wb.id}
              href={`/w/${slug}/whiteboards/${wb.id}`}
              className="block"
            >
              <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-base">{wb.name}</CardTitle>
                    <CardDescription className="text-xs">
                      Updated {formatDate(wb.updatedAt)}
                    </CardDescription>
                    {/* Creator display */}
                    <div className="flex items-center gap-1.5 pt-1">
                      {wb.createdBy ? (
                        <>
                          <Avatar className="h-4 w-4">
                            <AvatarImage src={wb.createdBy.image ?? undefined} />
                            <AvatarFallback className="text-[8px]">
                              {(wb.createdBy.name ?? "?").charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs text-muted-foreground truncate">
                            {wb.createdBy.name ?? "Unknown"}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    {wb.feature && (
                      <Link
                        href={`/w/${slug}/plan/${wb.feature.id}?tab=architecture`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-block"
                      >
                        <Badge
                          variant="secondary"
                          className="text-xs mt-1 cursor-pointer"
                        >
                          <Link2 className="w-3 h-3 mr-1" />
                          {wb.feature.title}
                        </Badge>
                      </Link>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteId(wb.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete whiteboard?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The whiteboard and all its contents
              will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
