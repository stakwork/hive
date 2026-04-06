"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Loader2, PenLine, Link2, MoreHorizontal, ArrowRightLeft } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FilterDropdownHeader, SortableColumnHeader } from "@/components/features/TableColumnHeaders";
import { MoveWhiteboardDialog } from "@/components/whiteboard/MoveWhiteboardDialog";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

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

function getPageRange(current: number, total: number): number[] {
  const range: number[] = [];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  for (let i = start; i <= end; i++) range.push(i);
  return range;
}

export default function WhiteboardsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { id: workspaceId, slug, role } = useWorkspace();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const [whiteboards, setWhiteboards] = useState<WhiteboardItem[]>([]);
  const [creatorOptions, setCreatorOptions] = useState<CreatorOption[]>([
    { value: "ALL", label: "All Creators", image: null },
  ]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveTarget, setMoveTarget] = useState<WhiteboardItem | null>(null);
  const [page, setPage] = useState(() => parseInt(searchParams?.get("page") ?? "1", 10) || 1);
  const [totalPages, setTotalPages] = useState(1);

  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) { try { return JSON.parse(saved).sortBy || "updatedAt"; } catch {} }
    }
    return "updatedAt";
  });

  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) { try { return JSON.parse(saved).sortOrder || "desc"; } catch {} }
    }
    return "desc";
  });

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

  const goToPage = useCallback((n: number) => {
    setPage(n);
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (n <= 1) { params.delete("page"); } else { params.set("page", n.toString()); }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  const handleSort = useCallback((field: "createdAt" | "updatedAt", order: "asc" | "desc" | null) => {
    if (order === null) {
      setSortBy("updatedAt");
      setSortOrder("desc");
    } else {
      if (sortBy !== field) goToPage(1);
      setSortBy(field);
      setSortOrder(order);
    }
  }, [sortBy, goToPage]);

  // Persist filter + sort to localStorage
  const handleCreatorFilterChange = useCallback((value: string | string[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    setCreatorFilter(next);
    goToPage(1);
  }, [goToPage]);

  // Persist filter + sort to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ creatorFilter, sortBy, sortOrder }));
    }
  }, [creatorFilter, sortBy, sortOrder]);

  // Initial load: fetch all (unfiltered) to build creator options list
  const loadCreatorOptions = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/whiteboards?workspaceId=${workspaceId}&limit=100`);
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
      const params = new URLSearchParams({ workspaceId, sortBy, sortOrder, page: String(page), limit: "24" });
      if (creatorFilter !== "ALL") {
        params.set("createdById", creatorFilter);
      }
      const res = await fetch(`/api/whiteboards?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setWhiteboards(data.data);
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages);
        }
      }
    } catch (error) {
      console.error("Error loading whiteboards:", error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, creatorFilter, sortBy, sortOrder, page]);

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
        <SortableColumnHeader
          label="Updated"
          field="updatedAt"
          currentSort={sortBy === "updatedAt" ? sortOrder : null}
          onSort={(order) => handleSort("updatedAt", order)}
        />
        <SortableColumnHeader
          label="Created"
          field="createdAt"
          currentSort={sortBy === "createdAt" ? sortOrder : null}
          onSort={(order) => handleSort("createdAt", order)}
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      {(role === "OWNER" || role === "ADMIN" || wb.createdBy?.id === currentUserId) && (
                        <DropdownMenuItem
                          onClick={() => setMoveTarget(wb)}
                        >
                          <ArrowRightLeft className="w-4 h-4 mr-2" />
                          Move to workspace
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteId(wb.id)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => { e.preventDefault(); goToPage(Math.max(1, page - 1)); }}
                  aria-disabled={page === 1}
                  className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
              {totalPages > 0 && (
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    onClick={(e) => { e.preventDefault(); goToPage(1); }}
                    isActive={page === 1}
                    className={page === 1 ? "pointer-events-none" : "cursor-pointer"}
                  >
                    1
                  </PaginationLink>
                </PaginationItem>
              )}
              {page > 4 && totalPages > 7 && (
                <PaginationItem><PaginationEllipsis /></PaginationItem>
              )}
              {getPageRange(page, totalPages).map((pageNum) => (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => { e.preventDefault(); goToPage(pageNum); }}
                    isActive={page === pageNum}
                    className={page === pageNum ? "pointer-events-none" : "cursor-pointer"}
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              ))}
              {page < totalPages - 3 && totalPages > 7 && (
                <PaginationItem><PaginationEllipsis /></PaginationItem>
              )}
              {totalPages > 1 && (
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    onClick={(e) => { e.preventDefault(); goToPage(totalPages); }}
                    isActive={page === totalPages}
                    className={page === totalPages ? "pointer-events-none" : "cursor-pointer"}
                  >
                    {totalPages}
                  </PaginationLink>
                </PaginationItem>
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => { e.preventDefault(); goToPage(Math.min(totalPages, page + 1)); }}
                  aria-disabled={page >= totalPages}
                  className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      <MoveWhiteboardDialog
        whiteboard={moveTarget}
        open={!!moveTarget}
        onOpenChange={(open) => { if (!open) setMoveTarget(null); }}
        onMoved={(whiteboardId) => {
          setWhiteboards((prev) => prev.filter((wb) => wb.id !== whiteboardId));
          setMoveTarget(null);
        }}
      />

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
