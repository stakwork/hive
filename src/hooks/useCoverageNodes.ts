import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { CoverageNodeConcise, CoverageNodesResponse, UncoveredNodeType } from "@/types/stakgraph";

export type StatusFilter = "all" | "tested" | "untested";

export interface UseCoverageParams {
  nodeType?: UncoveredNodeType;
  limit?: number;
  offset?: number;
  sort?: string;
  root?: string;
  concise?: boolean;
  status?: StatusFilter;
}


export function useCoverageNodes(initial: UseCoverageParams = {}) {
  const { id: workspaceId } = useWorkspace();

  const [nodeType, setNodeType] = useState<UncoveredNodeType>(initial.nodeType || "endpoint");
  const [limit, setLimit] = useState<number>(initial.limit ?? 10);
  const [offset, setOffset] = useState<number>(initial.offset ?? 0);
  const [sort, setSort] = useState<string>(initial.sort || "usage");
  const [root, setRoot] = useState<string>(initial.root || "");
  const [concise, setConcise] = useState<boolean>(initial.concise ?? true);
  const [status, setStatus] = useState<StatusFilter>(initial.status || "all");

  const [items, setItems] = useState<CoverageNodeConcise[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () => ({ nodeType, limit, offset, sort, root, concise, status }),
    [nodeType, limit, offset, sort, root, concise, status],
  );

  const fetchData = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qp = new URLSearchParams();
      qp.set("workspaceId", workspaceId);
      qp.set("node_type", nodeType);
      qp.set("limit", String(limit));
      qp.set("offset", String(offset));
      qp.set("sort", sort);
      if (root) qp.set("root", root);
      qp.set("concise", String(concise));

      const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
      const json: CoverageNodesResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to fetch coverage nodes");
      }
      let list = ((json.data?.items as CoverageNodeConcise[]) || []).slice();

      if (status === "tested") list = list.filter((n) => n.covered || (n.test_count || 0) > 0);
      if (status === "untested") list = list.filter((n) => !n.covered && (n.test_count || 0) === 0);

      list.sort((a, b) => {
        const aCovered = a.covered || (a.test_count || 0) > 0;
        const bCovered = b.covered || (b.test_count || 0) > 0;
        if (aCovered !== bCovered) return aCovered ? -1 : 1;
        const tcDiff = (b.test_count || 0) - (a.test_count || 0);
        if (tcDiff !== 0) return tcDiff;
        return (b.weight || 0) - (a.weight || 0);
      });

      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch coverage nodes");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, nodeType, limit, offset, sort, root, concise, status]);

  useEffect(() => {
    if (!workspaceId) return;
    fetchData();
  }, [fetchData, workspaceId]);

  const setPage = useCallback(
    (page: number) => {
      const newOffset = Math.max(0, (page - 1) * limit);
      setOffset(newOffset);
    },
    [limit],
  );

  const page = useMemo(() => Math.floor(offset / limit) + 1, [offset, limit]);

  return {
    items,
    loading,
    error,
    params,
    page,
    setPage,
    setNodeType,
    setLimit,
    setOffset,
    setSort,
    setRoot,
    setConcise,
    setStatus,
    refetch: fetchData,
  };
}
