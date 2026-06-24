"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { JargonCard, JargonCardSkeleton } from "./JargonCard";
import { NeighborView } from "./NeighborView";
import { LingoBreadcrumb, type BreadcrumbItem } from "./Breadcrumb";
import { AddEdgePanel } from "./AddEdgePanel";
import type { JargonNode } from "@/app/api/mock/lingo/nodes";
import type { NeighborEdge, NeighborNode } from "@/app/api/mock/lingo/neighbors";
import { useWorkspace } from "@/hooks/useWorkspace";

interface LingoExplorerProps {
  workspaceSlug: string;
}

export function LingoExplorer({ workspaceSlug }: LingoExplorerProps) {
  const { workspace } = useWorkspace();

  // List state
  const [view, setView] = useState<"list" | "detail">("list");
  const [nodes, setNodes] = useState<JargonNode[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nameFilter, setNameFilter] = useState("");

  // Detail state
  const [selectedNode, setSelectedNode] = useState<JargonNode | null>(null);
  const [edges, setEdges] = useState<NeighborEdge[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [deletedEdgeIds, setDeletedEdgeIds] = useState<Set<string>>(new Set());
  const [isAddEdgePanelOpen, setIsAddEdgePanelOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const isFetchingRef = useRef(false);
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────

  const fetchNodes = useCallback(
    async (currentOffset: number, replace = false) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      setIsLoadingMore(true);
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/lingo/nodes?limit=50&offset=${currentOffset}`,
        );
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Failed to load nodes");
        const incoming: JargonNode[] = json.data?.nodes ?? [];
        const more: boolean = json.data?.hasMore ?? false;
        setNodes((prev) => (replace ? incoming : [...prev, ...incoming]));
        setOffset(currentOffset + incoming.length);
        setHasMore(more);
      } catch {
        toast.error("Failed to load Jargon nodes");
        setHasMore(false);
        setHasError(true);
      } finally {
        setIsLoadingMore(false);
        isFetchingRef.current = false;
      }
    },
    [workspaceSlug],
  );

  const handleRetry = useCallback(() => {
    setHasError(false);
    fetchNodes(0, true);
  }, [fetchNodes]);

  useEffect(() => {
    fetchNodes(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug]);

  // ── Infinite scroll ───────────────────────────────────────────────────────

  const sentinelRef = useCallback(
    (sentinel: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!sentinel) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMoreRef.current && !isFetchingRef.current) {
            fetchNodes(offsetRef.current);
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(sentinel);
      observerRef.current = observer;
    },
    [fetchNodes],
  );

  // ── Detail navigation ─────────────────────────────────────────────────────

  const openDetail = useCallback(
    async (node: JargonNode, appendToBreadcrumb = true) => {
      setIsLoadingDetail(true);
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/lingo/nodes/${encodeURIComponent(node.ref_id)}`,
        );
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Failed to load node details");
        const neighborEdges: NeighborEdge[] = json.data?.edges ?? [];
        setSelectedNode(json.data?.node ?? node);
        setEdges(neighborEdges);
        setView("detail");
        if (appendToBreadcrumb) {
          setBreadcrumbs((prev) => {
            const exists = prev.findIndex((b) => b.ref_id === node.ref_id);
            if (exists !== -1) return prev.slice(0, exists + 1);
            return [...prev, { ref_id: node.ref_id, name: node.name }];
          });
        }
      } catch {
        toast.error("Failed to load node details");
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [workspaceSlug],
  );

  const handleCardClick = (node: JargonNode) => {
    setDeletedEdgeIds(new Set());
    openDetail(node, true);
  };

  const handleNavigateNeighbor = (neighbor: NeighborNode) => {
    const neighborAsNode: JargonNode = {
      ref_id: neighbor.ref_id,
      name: neighbor.name,
      jargon_context: "",
      jargon_candidates: [],
      created_at: "",
    };
    setDeletedEdgeIds(new Set());
    openDetail(neighborAsNode, true);
  };

  // ── Breadcrumb navigation ─────────────────────────────────────────────────

  const handleBreadcrumbNavigate = (index: number) => {
    if (index === -1) {
      // Home
      setView("list");
      setSelectedNode(null);
      setBreadcrumbs([]);
      return;
    }
    const target = breadcrumbs[index];
    if (!target) return;
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setDeletedEdgeIds(new Set());
    const asNode: JargonNode = {
      ref_id: target.ref_id,
      name: target.name,
      jargon_context: "",
      jargon_candidates: [],
      created_at: "",
    };
    openDetail(asNode, false);
  };

  // ── Optimistic edge delete ────────────────────────────────────────────────

  const handleDeleteEdge = (edgeRefId: string) => {
    // Optimistic removal
    setDeletedEdgeIds((prev) => new Set([...prev, edgeRefId]));

    let undone = false;
    toast("Connection removed", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          setDeletedEdgeIds((prev) => {
            const next = new Set(prev);
            next.delete(edgeRefId);
            return next;
          });
        },
      },
      onDismiss: () => {
        if (!undone) confirmDeleteEdge(edgeRefId);
      },
      onAutoClose: () => {
        if (!undone) confirmDeleteEdge(edgeRefId);
      },
    });
  };

  const confirmDeleteEdge = async (edgeRefId: string) => {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/lingo/edges/${encodeURIComponent(edgeRefId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_deleted: true }),
        },
      );
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      // Revert optimistic removal
      setDeletedEdgeIds((prev) => {
        const next = new Set(prev);
        next.delete(edgeRefId);
        return next;
      });
      toast.error("Failed to delete connection");
    }
  };

  // ── Filtered nodes ────────────────────────────────────────────────────────

  const filteredNodes = nameFilter
    ? nodes.filter((n) => n.name.toLowerCase().includes(nameFilter.toLowerCase()))
    : nodes;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full">
      {/* Top bar */}
      <div className="border-b px-6 py-4 flex items-center gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold">Lingo</h1>
          <p className="text-sm text-muted-foreground">Workspace jargon graph</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {/* Breadcrumbs (detail view) */}
        {view === "detail" && breadcrumbs.length > 0 && (
          <LingoBreadcrumb items={breadcrumbs} onNavigate={handleBreadcrumbNavigate} />
        )}

        {/* List view */}
        {view === "list" && (
          <>
            {/* Search filter */}
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Filter by name…"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="pl-9"
                data-testid="name-filter-input"
              />
            </div>

            {/* Node grid */}
            <div
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="jargon-card-grid"
            >
              {filteredNodes.map((node) => (
                <JargonCard
                  key={node.ref_id}
                  node={node}
                  onClick={() => handleCardClick(node)}
                />
              ))}
            </div>

            {/* Loading skeletons */}
            {isLoadingMore && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <JargonCardSkeleton />
                <JargonCardSkeleton />
                <JargonCardSkeleton />
              </div>
            )}

            {/* Sentinel for IntersectionObserver */}
            <div ref={sentinelRef} className="h-1" data-testid="scroll-sentinel" />

            {/* End of list */}
            {!hasMore && nodes.length > 0 && (
              <p
                className="text-center text-sm text-muted-foreground py-4"
                data-testid="no-more-terms"
              >
                No more terms
              </p>
            )}

            {/* Error state with retry */}
            {hasError && (
              <div className="flex flex-col items-center gap-3 py-12" data-testid="fetch-error-state">
                <p className="text-center text-sm text-muted-foreground">
                  Failed to load Jargon nodes.
                </p>
                <button
                  onClick={handleRetry}
                  className="text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                  data-testid="retry-button"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Empty state */}
            {!isLoadingMore && !hasError && nodes.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-12" data-testid="empty-state">
                No Jargon nodes found for this workspace.
              </p>
            )}
          </>
        )}

        {/* Detail view */}
        {view === "detail" && selectedNode && (
          <>
            {isLoadingDetail ? (
              <div className="flex flex-col gap-3">
                <div className="h-6 w-1/3 bg-primary/10 rounded animate-pulse" />
                <div className="h-4 w-2/3 bg-primary/10 rounded animate-pulse" />
                <div className="h-4 w-full bg-primary/10 rounded animate-pulse" />
              </div>
            ) : (
              <NeighborView
                node={selectedNode}
                edges={edges}
                deletedEdgeIds={deletedEdgeIds}
                onDeleteEdge={handleDeleteEdge}
                onNavigate={handleNavigateNeighbor}
                onAddEdge={() => setIsAddEdgePanelOpen(true)}
              />
            )}
          </>
        )}
      </div>

      {/* Add Edge Panel */}
      {selectedNode && (
        <AddEdgePanel
          sourceRefId={selectedNode.ref_id}
          workspaceSlug={workspaceSlug}
          workspaceId={workspace?.id ?? ""}
          isOpen={isAddEdgePanelOpen}
          onClose={() => setIsAddEdgePanelOpen(false)}
          onEdgeCreated={() => {
            // Re-fetch the current node's neighbors
            openDetail(selectedNode, false);
          }}
        />
      )}
    </div>
  );
}
