"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Loader2, PenLine } from "lucide-react";
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

interface WhiteboardItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export default function WhiteboardsPage() {
  const router = useRouter();
  const { id: workspaceId, slug } = useWorkspace();
  const [whiteboards, setWhiteboards] = useState<WhiteboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadWhiteboards = useCallback(async () => {
    if (!workspaceId) return;

    try {
      const res = await fetch(`/api/whiteboards?workspaceId=${workspaceId}`);
      const data = await res.json();
      if (data.success) {
        setWhiteboards(data.data);
      }
    } catch (error) {
      console.error("Error loading whiteboards:", error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

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

      {whiteboards.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="text-center py-12">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <PenLine className="w-6 h-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-lg">No whiteboards yet</CardTitle>
            <CardDescription>
              Create your first whiteboard to start collaborating
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {whiteboards.map((wb) => (
            <Card
              key={wb.id}
              className="cursor-pointer hover:border-primary/50 transition-colors group"
              onClick={() => router.push(`/w/${slug}/whiteboards/${wb.id}`)}
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="text-base">{wb.name}</CardTitle>
                  <CardDescription className="text-xs">
                    Updated {formatDate(wb.updatedAt)}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteId(wb.id);
                  }}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </CardHeader>
            </Card>
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
