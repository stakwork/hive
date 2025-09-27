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

export function useCoverageNodes() {
  const { id: workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { nodeType, sort, limit, offset, setOffset, setNodeType, setSort } = useCoverageStore();

  const queryKey = useMemo(
    () => ["coverage-nodes", workspaceId, nodeType, sort, limit, offset],
    [workspaceId, nodeType, sort, limit, offset],
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
      qp.set("limit", String(limit));
      qp.set("offset", String(offset));
      qp.set("sort", sort);

      const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
      const json: CoverageNodesResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to fetch coverage nodes");
      }
      const rawItems = ((json.data?.items as CoverageNodeConcise[]) || []).slice();
      const items = rawItems.slice(0, limit);
      const hasNext = (json.data?.hasNextPage ?? rawItems.length >= limit) as boolean;
      return { items, hasNextPage: hasNext };
    },
  });

  const hasNextPage = Boolean(query.data?.hasNextPage);
  const hasPrevPage = offset > 0;

  const prefetch = async (targetPage: number) => {
    if (!workspaceId) return;
    const prefetchKey = ["coverage-nodes", workspaceId, nodeType, sort, limit, targetPage];
    await queryClient.prefetchQuery({
      queryKey: prefetchKey,
      queryFn: async () => {
        const qp = new URLSearchParams();
        qp.set("workspaceId", workspaceId);
        qp.set("node_type", nodeType);
        qp.set("limit", String(limit));
        qp.set("offset", String(targetPage));
        qp.set("sort", sort);
        const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
        const json: CoverageNodesResponse = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to fetch coverage nodes");
        }
        const rawItems = ((json.data?.items as CoverageNodeConcise[]) || []).slice();
        const items = rawItems.slice(0, limit);
        const hasNext = (json.data?.hasNextPage ?? rawItems.length >= limit) as boolean;
        return { items, hasNextPage: hasNext };
      },
    });
  };

  return {
    items: query.data?.items || [],
    loading: query.isLoading,
    filterLoading: query.isFetching && !query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    params: { nodeType, limit, offset, sort },
    page: Math.floor(offset / limit) + 1,
    hasNextPage,
    hasPrevPage,
    setPage: (p: number) => setOffset(Math.max(0, (p - 1) * limit)),
    prefetchNext: () => prefetch(offset + limit),
    prefetchPrev: () => prefetch(Math.max(0, offset - limit)),
    setNodeType,
    setLimit: (n: number) => useCoverageStore.setState({ limit: n, offset: 0 }),
    setSort,
    setRoot: () => {},
    setConcise: () => {},
    setStatus: () => {},
    refetch: () => query.refetch(),
  };
}
