import { useMemo } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoverageNodesResponse } from "@/types/stakgraph";
import { useCoverageStore } from "@/stores/useCoverageStore";

export type StatusFilter = "all" | "tested" | "untested";

export interface UseCoverageParams {
  root?: string;
  concise?: boolean;
}

export function useCoverageNodes() {
  const { id: workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { nodeType, sort, limit, offset, coverage, setOffset, setNodeType, setSort, setCoverage } = useCoverageStore();

  const queryKey = useMemo(
    () => ["coverage-nodes", workspaceId, nodeType, sort, limit, offset, coverage],
    [workspaceId, nodeType, sort, limit, offset, coverage],
  );

  const query = useQuery<CoverageNodesResponse | null>({
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
      if (sort === "body_length") {
        qp.set("body_length", "true");
      } else if (sort === "line_count") {
        qp.set("line_count", "true");
      } else {
        qp.set("sort", sort);
      }
      if (coverage && coverage !== "all") qp.set("coverage", coverage);
      const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
      const json: CoverageNodesResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to fetch coverage nodes");
      }
      return json;
    },
  });

  const hasNextPage = Boolean(query.data?.data?.hasNextPage);
  const hasPrevPage = offset > 0;

  const prefetch = async (targetPage: number) => {
    if (!workspaceId) return;
    const prefetchKey = ["coverage-nodes", workspaceId, nodeType, sort, limit, targetPage, coverage];
    await queryClient.prefetchQuery({
      queryKey: prefetchKey,
      queryFn: async () => {
        const qp = new URLSearchParams();
        qp.set("workspaceId", workspaceId);
        qp.set("node_type", nodeType);
        qp.set("limit", String(limit));
        qp.set("offset", String(targetPage));
        if (sort === "body_length") {
          qp.set("body_length", "true");
        } else if (sort === "line_count") {
          qp.set("line_count", "true");
        } else {
          qp.set("sort", sort);
        }
        if (coverage && coverage !== "all") qp.set("coverage", coverage);
        const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
        const json: CoverageNodesResponse = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to fetch coverage nodes");
        }
        return json;
      },
    });
  };

  return {
    items: query.data?.data?.items || [],
    loading: query.isLoading,
    filterLoading: query.isFetching && !query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    params: { nodeType, limit, offset, sort, coverage },
    page: query.data?.data?.page || 1,
    totalPages: query.data?.data?.total_pages,
    totalCount: query.data?.data?.total_count,
    totalReturned: query.data?.data?.total_returned,
    hasNextPage,
    hasPrevPage,
    setPage: (p: number) => setOffset(Math.max(0, (p - 1) * limit)),
    prefetchNext: () => prefetch(offset + limit),
    prefetchPrev: () => prefetch(Math.max(0, offset - limit)),
    setNodeType,
    setLimit: (n: number) => useCoverageStore.setState({ limit: n, offset: 0 }),
    setSort,
    setCoverage,
    setRoot: () => {},
    setConcise: () => {},
    setStatus: () => {},
    refetch: () => query.refetch(),
  };
}
