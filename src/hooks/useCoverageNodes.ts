import { useMemo } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoverageNodeConcise, CoverageNodesResponse } from "@/types/stakgraph";
import { useCoverageStore } from "@/stores/useCoverageStore";

export type StatusFilter = "all" | "tested" | "untested";

export interface UseCoverageParams {
  root?: string;
  concise?: boolean;
}

export function useCoverageNodes(initial: UseCoverageParams = {}) {
  const { id: workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { nodeType, status, sort, pageSize, page, root, concise, setPage, setNodeType, setStatus } = useCoverageStore();
  if (initial.root !== undefined && initial.root !== root) {
    useCoverageStore.setState({ root: initial.root });
  }
  if (initial.concise !== undefined && initial.concise !== concise) {
    useCoverageStore.setState({ concise: initial.concise });
  }

  const queryKey = useMemo(
    () => ["coverage-nodes", workspaceId, nodeType, status, sort, page, pageSize, root, concise],
    [workspaceId, nodeType, status, sort, page, pageSize, root, concise],
  );

  const query = useQuery<{ items: CoverageNodeConcise[]; hasNextPage?: boolean } | null>({
    queryKey,
    enabled: Boolean(workspaceId),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!workspaceId) return null;
      const qp = new URLSearchParams();
      qp.set("workspaceId", workspaceId);
      qp.set("node_type", nodeType);
      qp.set("page", String(page));
      qp.set("pageSize", String(pageSize));
      qp.set("sort", sort);
      if (root) qp.set("root", root);
      qp.set("status", status);

      const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
      const json: CoverageNodesResponse = await res.json();
      if (process.env.NODE_ENV === "development") {
        try {
          console.log("[useCoverageNodes] upstream query:", Object.fromEntries(qp.entries()));
          console.log("[useCoverageNodes] upstream data:", JSON.stringify(json).slice(0, 4000));
        } catch {}
      }
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to fetch coverage nodes");
      }
      const rawItems = ((json.data?.items as CoverageNodeConcise[]) || []).slice();
      const items = rawItems.slice(0, pageSize);
      const hasNext = (json.data?.hasNextPage ?? rawItems.length >= pageSize) as boolean;
      return { items, hasNextPage: hasNext };
    },
  });

  const hasNextPage = Boolean(query.data?.hasNextPage);
  const hasPrevPage = page > 1;

  const prefetch = async (targetPage: number) => {
    if (!workspaceId) return;
    const prefetchKey = ["coverage-nodes", workspaceId, nodeType, status, sort, targetPage, pageSize, root, concise];
    await queryClient.prefetchQuery({
      queryKey: prefetchKey,
      queryFn: async () => {
        const qp = new URLSearchParams();
        qp.set("workspaceId", workspaceId);
        qp.set("node_type", nodeType);
        qp.set("page", String(targetPage));
        qp.set("pageSize", String(pageSize));
        qp.set("sort", sort);
        if (root) qp.set("root", root);
        qp.set("status", status);
        const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
        const json: CoverageNodesResponse = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to fetch coverage nodes");
        }
        const rawItems = ((json.data?.items as CoverageNodeConcise[]) || []).slice();
        const items = rawItems.slice(0, pageSize);
        const hasNext = (json.data?.hasNextPage ?? rawItems.length >= pageSize) as boolean;
        return { items, hasNextPage: hasNext };
      },
    });
  };

  return {
    items: query.data?.items || [],
    loading: query.isLoading,
    filterLoading: query.isFetching && !query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    params: { nodeType, limit: pageSize, offset: (page - 1) * pageSize, sort, root, concise, status },
    page,
    hasNextPage,
    hasPrevPage,
    setPage: (p: number) => setPage(Math.max(1, p)),
    prefetchNext: () => prefetch(page + 1),
    prefetchPrev: () => prefetch(Math.max(1, page - 1)),
    setNodeType,
    setLimit: (n: number) => useCoverageStore.setState({ pageSize: n }),
    setSort: (s: string) => useCoverageStore.setState({ sort: s }),
    setRoot: (v: string) => useCoverageStore.setState({ root: v }),
    setConcise: (v: boolean) => useCoverageStore.setState({ concise: v }),
    setStatus,
    refetch: () => query.refetch(),
  };
}
