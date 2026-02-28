"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronUp, ChevronDown, Eye, EyeOff, Copy, Check, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PresignedImage } from "@/components/ui/presigned-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SortField = "name" | "members" | "pods" | "tasks" | "createdAt";
type SortDirection = "asc" | "desc";

interface WorkspaceData {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  createdAt: Date;
  owner: {
    name: string | null;
    email: string | null;
  };
  hasSwarmPassword: boolean;
  _count: {
    members: number;
    tasks: number;
  };
}

interface WorkspacesTableProps {
  workspaces: WorkspaceData[];
}

export function WorkspacesTable({ workspaces }: WorkspacesTableProps) {
  const router = useRouter();
  const [sortState, setSortState] = useState<{ field: SortField; direction: SortDirection }>({
    field: "createdAt",
    direction: "desc",
  });
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [copiedPasswords, setCopiedPasswords] = useState<Record<string, boolean>>({});
  const [loadingPasswords, setLoadingPasswords] = useState<Record<string, boolean>>({});
  const [deletingWorkspace, setDeletingWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Live pod counts state
  interface PodCount {
    usedVms: number;
    totalPods: number;
  }
  const [podCounts, setPodCounts] = useState<Record<string, PodCount>>({});

  // Fetch logos on mount for workspaces that have logoKey
  useEffect(() => {
    const fetchLogos = async () => {
      const workspacesWithLogos = workspaces.filter((ws) => ws.logoKey);
      
      const logoPromises = workspacesWithLogos.map(async (workspace) => {
        try {
          const response = await fetch(`/api/workspaces/${workspace.slug}/image`);
          if (response.ok) {
            const data = await response.json();
            return { slug: workspace.slug, url: data.url };
          }
        } catch (error) {
          console.error(`Failed to fetch logo for ${workspace.slug}:`, error);
        }
        return null;
      });

      const results = await Promise.all(logoPromises);
      const newLogoUrls: Record<string, string> = {};
      
      results.forEach((result) => {
        if (result) {
          newLogoUrls[result.slug] = result.url;
        }
      });

      setLogoUrls(newLogoUrls);
    };

    fetchLogos();
  }, [workspaces]);

  // Fetch pod counts from API with polling
  useEffect(() => {
    const fetchPodCounts = async () => {
      try {
        const response = await fetch("/api/admin/pods");
        if (response.ok) {
          const data = await response.json();
          const countsMap: Record<string, PodCount> = {};
          data.workspaces.forEach(
            (ws: { workspaceId: string; usedVms: number; totalPods: number }) => {
              countsMap[ws.workspaceId] = {
                usedVms: ws.usedVms,
                totalPods: ws.totalPods,
              };
            }
          );
          setPodCounts(countsMap);
        }
      } catch (error) {
        console.error("Failed to fetch pod counts:", error);
      }
    };

    // Fetch immediately on mount
    fetchPodCounts();

    // Set up polling interval
    let intervalId: NodeJS.Timeout | null = setInterval(fetchPodCounts, 30000);

    // Handle visibility change
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Clear interval when tab is hidden
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } else {
        // Fetch immediately and restart interval when tab becomes visible
        fetchPodCounts();
        if (!intervalId) {
          intervalId = setInterval(fetchPodCounts, 30000);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleSort = (field: SortField) => {
    setSortState((prev) => {
      if (prev.field === field) {
        // Toggle direction if clicking the same field
        const newState = { field, direction: prev.direction === "asc" ? "desc" : "asc" as SortDirection };
        return newState;
      } else {
        // Default to ascending when switching fields
        const newState = { field, direction: "asc" as SortDirection };
        return newState;
      }
    });
  };

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    let comparison = 0;

    switch (sortState.field) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "members":
        comparison = (a._count.members + 1) - (b._count.members + 1);
        break;
      case "pods":
        const podsA = podCounts[a.id]?.usedVms ?? 0;
        const podsB = podCounts[b.id]?.usedVms ?? 0;
        comparison = podsA - podsB;
        break;
      case "tasks":
        comparison = a._count.tasks - b._count.tasks;
        break;
      case "createdAt":
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }

    return sortState.direction === "asc" ? comparison : -comparison;
  });

  const refetchLogo = async (slug: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/workspaces/${slug}/image`);
      if (response.ok) {
        const data = await response.json();
        setLogoUrls((prev) => ({ ...prev, [slug]: data.url }));
        return data.url;
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch logo:", error);
      return null;
    }
  };

  const fetchPassword = async (workspaceId: string): Promise<string | null> => {
    if (revealedPasswords[workspaceId]) {
      return revealedPasswords[workspaceId];
    }

    setLoadingPasswords((prev) => ({ ...prev, [workspaceId]: true }));
    try {
      const response = await fetch(`/api/admin/workspaces/${workspaceId}/swarm-password`);
      if (response.ok) {
        const data = await response.json();
        setRevealedPasswords((prev) => ({ ...prev, [workspaceId]: data.password }));
        return data.password;
      }
      console.error("Failed to fetch password:", response.statusText);
      return null;
    } catch (error) {
      console.error("Failed to fetch password:", error);
      return null;
    } finally {
      setLoadingPasswords((prev) => ({ ...prev, [workspaceId]: false }));
    }
  };

  const togglePasswordVisibility = async (workspaceId: string) => {
    if (!revealedPasswords[workspaceId]) {
      // Fetch on first reveal
      await fetchPassword(workspaceId);
    }
    setVisiblePasswords((prev) => ({ ...prev, [workspaceId]: !prev[workspaceId] }));
  };

  const copyPassword = async (workspaceId: string) => {
    const password = await fetchPassword(workspaceId);
    if (password) {
      await navigator.clipboard.writeText(password);
      setCopiedPasswords((prev) => ({ ...prev, [workspaceId]: true }));
      setTimeout(() => {
        setCopiedPasswords((prev) => ({ ...prev, [workspaceId]: false }));
      }, 2000);
    }
  };

  const handleAdminDelete = async () => {
    if (!deletingWorkspace || deleteConfirmText !== deletingWorkspace.name) {
      toast.error("Confirmation failed", {
        description: "Please type the workspace name exactly as shown.",
      });
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/workspaces/${deletingWorkspace.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete workspace");
      }
      toast.success("Workspace deleted");
      setDeletingWorkspace(null);
      setDeleteConfirmText("");
      router.refresh();
    } catch (error) {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Failed to delete workspace.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortState.field !== field) return null;
    return sortState.direction === "asc" ? (
      <ChevronUp className="inline w-4 h-4 ml-1" />
    ) : (
      <ChevronDown className="inline w-4 h-4 ml-1" />
    );
  };

  const SortableHeader = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-muted/50"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center">
        {children}
        <SortIcon field={field} />
      </div>
    </TableHead>
  );

  if (workspaces.length === 0) {
    return <p className="text-muted-foreground">No workspaces found</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]">Icon</TableHead>
            <SortableHeader field="name">Name</SortableHeader>
            <TableHead>Slug</TableHead>
            <TableHead>Created By</TableHead>
            <SortableHeader field="members">Members</SortableHeader>
            <SortableHeader field="pods">Pods</SortableHeader>
            <SortableHeader field="tasks">Tasks</SortableHeader>
            <SortableHeader field="createdAt">Created</SortableHeader>
            <TableHead>Swarm Password</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
      <TableBody>
        {sortedWorkspaces.map((workspace) => (
          <TableRow key={workspace.id}>
            <TableCell>
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                {workspace.logoKey ? (
                  <PresignedImage
                    src={logoUrls[workspace.slug]}
                    alt={workspace.name}
                    className="w-full h-full object-cover rounded-lg"
                    onRefetchUrl={() => refetchLogo(workspace.slug)}
                    fallback={<Building2 className="w-4 h-4" />}
                  />
                ) : (
                  <Building2 className="w-4 h-4" />
                )}
              </div>
            </TableCell>
            <TableCell className="font-medium">{workspace.name}</TableCell>
            <TableCell>
              <code className="text-xs">{workspace.slug}</code>
            </TableCell>
            <TableCell>
              <span className="text-sm text-muted-foreground">
                {workspace.owner.name ?? workspace.owner.email}
              </span>
            </TableCell>
            <TableCell>{workspace._count.members + 1}</TableCell>
            <TableCell>
              {podCounts[workspace.id]
                ? `${podCounts[workspace.id].usedVms} in use / ${podCounts[workspace.id].totalPods} total`
                : "—"}
            </TableCell>
            <TableCell>{workspace._count.tasks}</TableCell>
            <TableCell>
              {new Date(workspace.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              {!workspace.hasSwarmPassword ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="text-xs">
                    {visiblePasswords[workspace.id] && revealedPasswords[workspace.id]
                      ? revealedPasswords[workspace.id]
                      : "••••••••"}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => togglePasswordVisibility(workspace.id)}
                    disabled={loadingPasswords[workspace.id]}
                  >
                    {visiblePasswords[workspace.id] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => copyPassword(workspace.id)}
                    disabled={loadingPasswords[workspace.id]}
                  >
                    {copiedPasswords[workspace.id] ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/workspaces/${workspace.slug}`}
                  className="text-sm text-primary hover:underline"
                >
                  View workspace →
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeletingWorkspace({ id: workspace.id, name: workspace.name });
                    setDeleteConfirmText("");
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    <Dialog
      open={!!deletingWorkspace}
      onOpenChange={(open) => {
        if (!open) {
          setDeletingWorkspace(null);
          setDeleteConfirmText("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Delete Workspace
          </DialogTitle>
          <DialogDescription>
            This will permanently delete &ldquo;{deletingWorkspace?.name}&rdquo; and all its data. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">
              <strong>Warning:</strong> All data will be permanently lost.
            </p>
          </div>
          <div className="space-y-2">
            <Label>
              Type <strong>{deletingWorkspace?.name}</strong> to confirm:
            </Label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deletingWorkspace?.name}
              disabled={isDeleting}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setDeletingWorkspace(null);
              setDeleteConfirmText("");
            }}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleAdminDelete}
            disabled={deleteConfirmText !== deletingWorkspace?.name || isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
